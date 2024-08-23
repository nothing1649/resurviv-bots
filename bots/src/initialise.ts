import type * as net from "../../shared/net/net";
import {
    type ObjectData,
    ObjectType,
    type ObjectsPartialData,
} from "../../shared/net/objectSerializeFns";
import { Bot } from "./bot";

const config = {
    address: "http://127.0.0.1:8001",
    region: "local",
    gameModeIdx: 0,
    botCount: 79,
    joinDelay: 100,
};

const bots = new Set<Bot>();

let allBotsJoined = false;

interface GameObject {
    __id: number;
    __type: ObjectType;
    data: ObjectData<ObjectType>;
}

export class ObjectCreator {
    idToObj: Record<number, GameObject> = {};

    getObjById(id: number) {
        return this.idToObj[id];
    }

    getTypeById(id: number, s: net.BitStream) {
        const obj = this.getObjById(id);
        if (!obj) {
            const err = {
                id,
                ids: Object.keys(this.idToObj),
                stream: s._view._view,
            };
            console.error("objectPoolErr", `getTypeById${JSON.stringify(err)}`);
            return ObjectType.Invalid;
        }
        return obj.__type;
    }

    updateObjFull<Type extends ObjectType>(
        type: Type,
        id: number,
        data: ObjectData<Type>,
    ) {
        let obj = this.getObjById(id);
        if (obj === undefined) {
            obj = {} as GameObject;
            obj.__id = id;
            obj.__type = type;
            this.idToObj[id] = obj;
        }
        obj.data = data;
        return obj;
    }

    updateObjPart<Type extends ObjectType>(id: number, data: ObjectsPartialData[Type]) {
        const obj = this.getObjById(id);
        if (obj) {
            for (const dataKey in data) {
                // @ts-expect-error too lazy;
                obj.data[dataKey] = data;
            }
        } else {
            console.error("updateObjPart, missing object", id);
        }
    }

    deleteObj(id: number) {
        const obj = this.getObjById(id);
        if (obj === undefined) {
            console.error("deleteObj, missing object", id);
        } else {
            delete this.idToObj[id];
        }
    }
}

void (async () => {
    for (let i = 1; i <= config.botCount; i++) {
        setTimeout(async () => {
            const response = await (
                await fetch(`${config.address}/api/find_game`, {
                    method: "POST",
                    body: JSON.stringify({
                        region: config.region,
                        gameModeIdx: config.gameModeIdx,
                    }),
                })
            ).json();

            bots.add(new Bot(i, response.res[0]));
            if (i === config.botCount) allBotsJoined = true;
        }, i * config.joinDelay);
    }
})();

setInterval(() => {
    for (const bot of bots) {
        if (Math.random() < 0.02) bot.updateInputs();

        bot.sendInputs();

        if (bot.disconnect) {
            bots.delete(bot);
        }
    }

    if (bots.size === 0 && allBotsJoined) {
        console.log("All bots died or disconnected, exiting.");
        process.exit();
    }
}, 30);
