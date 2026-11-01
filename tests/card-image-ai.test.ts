import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({openai:vi.fn(),gemini:vi.fn(),claude:vi.fn()}));
vi.mock("../server/services/llm",async original=>({...await original<object>(),openaiRequest:mocks.openai,getClient:()=>({messages:{create:mocks.claude}})}));
vi.mock("../server/services/gemini",()=>({geminiRequest:mocks.gemini}));
import {describeCardImages} from "../server/services/cardImageAi";
beforeEach(()=>{vi.clearAllMocks();});
const input={instruction:"보이는 내용만",context:"캐릭터 자료",images:[Buffer.from("one"),Buffer.from("two")],altOnly:true};
it("sends ordered inline images to the selected Gemini provider without calling OpenAI",async()=>{
 mocks.gemini.mockResolvedValue({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({altTexts:["첫 장","둘째 장"]})}]}}]});
 expect(await describeCardImages({...input,provider:"gemini"})).toEqual({altTexts:["첫 장","둘째 장"]});
 const body=mocks.gemini.mock.calls[0][0];expect(body.contents[0].parts.filter((p:any)=>p.inlineData).map((p:any)=>p.inlineData.data)).toEqual(input.images.map(b=>b.toString("base64")));
 expect(body.generationConfig.responseJsonSchema.required).toEqual(["altTexts"]);expect(mocks.openai).not.toHaveBeenCalled();
});
it("fails incomplete Gemini output without falling back or altering content",async()=>{
 mocks.gemini.mockResolvedValue({candidates:[{finishReason:"MAX_TOKENS"}]});
 await expect(describeCardImages({...input,provider:"gemini"})).rejects.toThrow("완성되지 않았습니다");expect(mocks.openai).not.toHaveBeenCalled();expect(mocks.gemini).toHaveBeenCalledTimes(1);
});
it("supports the selected Claude provider with ordered image blocks",async()=>{
 process.env.ANTHROPIC_API_KEY="test";
 try{mocks.claude.mockResolvedValue({stop_reason:"tool_use",content:[{type:"tool_use",name:"suggest_caption",input:{altTexts:["첫 장","둘째 장"]}}]});
 expect(await describeCardImages({...input,provider:"anthropic"})).toEqual({altTexts:["첫 장","둘째 장"]});expect(mocks.claude.mock.calls[0][0].messages[0].content.filter((p:any)=>p.type==="image")).toHaveLength(2);expect(mocks.openai).not.toHaveBeenCalled();}finally{delete process.env.ANTHROPIC_API_KEY;}
});
it("keeps caption generation optional for OpenAI",async()=>{
 mocks.openai.mockResolvedValue({output:[{type:"function_call",name:"suggest_caption",arguments:JSON.stringify({caption:"캡션",altTexts:["첫 장","둘째 장"]})}]});
 await describeCardImages({...input,provider:"openai",altOnly:false});expect(mocks.openai.mock.calls[0][1].tools[0].parameters.required).toEqual(["caption","altTexts"]);
});
