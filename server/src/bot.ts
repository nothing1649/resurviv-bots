import assert from "assert";
import WebSocket from "ws";
import { EmotesDefs } from "../../shared/defs/gameObjects/emoteDefs";
import { MeleeDefs } from "../../shared/defs/gameObjects/meleeDefs";
import { OutfitDefs } from "../../shared/defs/gameObjects/outfitDefs";
import { UnlockDefs } from "../../shared/defs/gameObjects/unlockDefs";
import { GameConfig } from "../../shared/gameConfig";
import * as net from "../../shared/net/net";
import { util } from "../../shared/utils/util";
import { v2 } from "../../shared/utils/v2";
import { ObjectCreator } from "./stressTest";
import type { FindGameResponse } from "./gameServer";

//
// Cache random loadout types
//

const outfits: string[] = [];
for (const outfit in OutfitDefs) {
    if (!UnlockDefs.unlock_default.unlocks.includes(outfit)) continue;
    outfits.push(outfit);
}


const emotes: string[] = [];
for (const emote in EmotesDefs) {
    if (!UnlockDefs.unlock_default.unlocks.includes(emote)) continue;
    emotes.push(emote);
}

const melees: string[] = [];
for (const melee in MeleeDefs) {
    if (!UnlockDefs.unlock_default.unlocks.includes(melee)) continue;
    melees.push(melee);
}

export class Bot {
    moving = {
        up: false,
        down: false,
        left: false,
        right: false,
    };

    shootStart = false;

    interact = false;

    emotes: string[];

    emote = false;

    angle = util.random(-Math.PI, Math.PI);
    angularSpeed = util.random(0, 0.1);

    toMouseLen = 50;

    connected = false;

    disconnect = false;

    id: number;

    ws: WebSocket;

    objectCreator = new ObjectCreator();

    constructor(id: number, res: FindGameResponse["res"][0]) {
        this.id = id;

        assert("gameId" in res);
        this.ws = new WebSocket(
            `${res.useHttps ? "wss" : "ws"}://${res.addrs[0]}/play?gameId=${res.gameId}`,
        );

        this.ws.addEventListener("error", console.error);

        this.ws.addEventListener("open", this.join.bind(this));

        this.ws.addEventListener("close", () => {
            this.disconnect = true;
            this.connected = false;
        });

        this.ws.binaryType = "arraybuffer";

        const emote = (): string => emotes[util.randomInt(0, emotes.length - 1)];

        this.emotes = [emote(), emote(), emote(), emote(), emote(), emote()];

        this.ws.onmessage = (message: WebSocket.MessageEvent): void => {
            const stream = new net.MsgStream(message.data as ArrayBuffer);
            while (true) {
                const type = stream.deserializeMsgType();
                if (type == net.MsgType.None) {
                    break;
                }
                this.onMsg(type, stream.getStream());
            }
        };
    }

    onMsg(type: number, stream: net.BitStream): void {
        switch (type) {
            case net.MsgType.Joined: {
                const msg = new net.JoinedMsg();
                msg.deserialize(stream);
                this.emotes = msg.emotes;
                break;
            }
            case net.MsgType.Map: {
                const msg = new net.MapMsg();
                msg.deserialize(stream);
                break;
            }
            case net.MsgType.Update: {
                const msg = new net.UpdateMsg();
                msg.deserialize(stream, this.objectCreator);

                // Delete objects
                for (let i = 0; i < msg.delObjIds.length; i++) {
                    this.objectCreator.deleteObj(msg.delObjIds[i]);
                }

                // Update full objects
                for (let i = 0; i < msg.fullObjects.length; i++) {
                    const obj = msg.fullObjects[i];
                    this.objectCreator.updateObjFull(obj.__type, obj.__id, obj);
                }

                // Update partial objects
                for (let i = 0; i < msg.partObjects.length; i++) {
                    const obj = msg.partObjects[i];
                    this.objectCreator.updateObjPart(obj.__id, obj);
                }

                break;
            }
            case net.MsgType.Kill: {
                const msg = new net.KillMsg();
                msg.deserialize(stream);
                break;
            }
            case net.MsgType.RoleAnnouncement: {
                const msg = new net.RoleAnnouncementMsg();
                msg.deserialize(stream);
                break;
            }
            case net.MsgType.PlayerStats: {
                const msg = new net.PlayerStatsMsg();
                msg.deserialize(stream);
                break;
            }
            case net.MsgType.GameOver: {
                const msg = new net.GameOverMsg();
                msg.deserialize(stream);
                console.log(
                    `Bot ${this.id} ${msg.gameOver ? "won" : "died"} | kills: ${msg.playerStats[0].kills} | rank: ${msg.teamRank}`,
                );
                this.disconnect = true;
                this.connected = false;
                this.ws.close();
                break;
            }
            case net.MsgType.Pickup: {
                const msg = new net.PickupMsg();
                msg.deserialize(stream);
                break;
            }
            case net.MsgType.UpdatePass: {
                new net.UpdatePassMsg().deserialize(stream);
                break;
            }
            case net.MsgType.AliveCounts: {
                const msg = new net.AliveCountsMsg();
                msg.deserialize(stream);
                break;
            }
            case net.MsgType.Disconnect: {
                const msg = new net.DisconnectMsg();
                msg.deserialize(stream);
            }
        }
    }

    stream = new net.MsgStream(new ArrayBuffer(1024));

    join(): void {
        this.connected = true;

        const joinMsg = new net.JoinMsg();

        joinMsg.name = `BOT_${this.id}`;
        joinMsg.isMobile = false;
        joinMsg.protocol = GameConfig.protocolVersion;

        joinMsg.loadout = {
            melee: melees[util.randomInt(0, melees.length - 1)],
            outfit: outfits[util.randomInt(0, outfits.length - 1)],
            heal: "heal_basic",
            boost: "boost_basic",
            emotes: this.emotes,
        };
        this.sendMsg(net.MsgType.Join, joinMsg);
    }

    sendMsg(type: net.MsgType, msg: net.Msg): void {
        this.stream.stream.index = 0;
        this.stream.serializeMsg(type, msg);

        this.ws.send(this.stream.getBuffer());
    }

    sendInputs(): void {
        if (!this.connected) return;

        const inputPacket = new net.InputMsg();

        inputPacket.moveDown = this.moving.down;
        inputPacket.moveUp = this.moving.up;
        inputPacket.moveLeft = this.moving.left;
        inputPacket.moveRight = this.moving.right;

        inputPacket.shootStart = this.shootStart;

        inputPacket.toMouseDir = v2.create(Math.cos(this.angle), Math.sin(this.angle));
        inputPacket.toMouseLen = this.toMouseLen;

        this.angle += this.angularSpeed;
        if (this.angle > Math.PI) this.angle = -Math.PI;

        if (this.interact) {
            inputPacket.addInput(GameConfig.Input.Interact);
        }

        this.sendMsg(net.MsgType.Input, inputPacket);

        if (this.emote) {
            const emoteMsg = new net.EmoteMsg();
            emoteMsg.type = this.emotes[util.randomInt(0, this.emotes.length - 1)];
        }
    }

    updateInputs(): void {
        this.moving = {
            up: false,
            down: false,
            left: false,
            right: false,
        };

        this.shootStart = Math.random() < 0.5;
        this.interact = Math.random() < 0.5;
        this.emote = Math.random() < 0.5;

        switch (util.randomInt(1, 8)) {
            case 1:
                this.moving.up = true;
                break;
            case 2:
                this.moving.down = true;
                break;
            case 3:
                this.moving.left = true;
                break;
            case 4:
                this.moving.right = true;
                break;
            case 5:
                this.moving.up = true;
                this.moving.left = true;
                break;
            case 6:
                this.moving.up = true;
                this.moving.right = true;
                break;
            case 7:
                this.moving.down = true;
                this.moving.left = true;
                break;
            case 8:
                this.moving.down = true;
                this.moving.right = true;
                break;
        }
    }
}
