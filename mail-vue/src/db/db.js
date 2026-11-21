import Dexie from "dexie";
import {useUserStore} from "@/store/user.js"
import { watch, shallowRef } from "vue";

const userStore = useUserStore();


let db =  shallowRef({})

function createDB() {
    const database = new Dexie(userStore.user.email);
    database.version(1).stores({draft: '++draftId,createTime',att: 'draftId'});
    database.version(2).stores({draft:'++draftId,createTime,cloudDraftId',att:'draftId',meta:'key'});
    database.version(3).stores({discardUndo:'[operation+originalId],operation,expires'});
    db.value = database;

}

createDB()

watch(() => userStore.user.email,() => createDB())

export default db;