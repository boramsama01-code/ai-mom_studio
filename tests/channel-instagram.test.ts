import {expect,it} from "vitest";
import {expectedInstagramUsername,instagramAccountMismatch} from "../shared/channelInstagram";
it("routes each current and legacy channel key to the operator's exact handle",()=>{
 expect(["penguin","highscoop","highway","opportunities","news","current-dialogue","science-dialogue","fryday"].map(expectedInstagramUsername)).toEqual(["spacepenguin.co","highscoop.official","highscoop.official","highscoop.official","alligodang.official","alligodang.official","alligodang.official","fryday.official.kr"]);
 expect(instagramAccountMismatch("news","@ALLIGODANG.OFFICIAL")).toBeNull();expect(instagramAccountMismatch("highscoop","spacepenguin.co")).toContain("highscoop.official");expect(expectedInstagramUsername("custom")).toBeNull();
});
