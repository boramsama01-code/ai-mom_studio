import { describe,expect,it } from "vitest";
import { emptyVideoProject,videoProjectSchema,videoSubtitles } from "../shared/videoProject";
describe("video planning and real subtitle output", () => {
  it("preserves silent-scene time and rounds subtitle milliseconds", () => {
    const project=videoProjectSchema.parse({...emptyVideoProject(),scenes:[
      {id:"00000000-0000-4000-8000-000000000001",duration:1.25,subtitle:""},
      {id:"00000000-0000-4000-8000-000000000002",duration:2.75,subtitle:"첫 자막\n둘째 줄"},
      {id:"00000000-0000-4000-8000-000000000003",duration:60,subtitle:"다음 장면"},
    ]});
    expect(videoSubtitles(project)).toBe("1\n00:00:01,250 --> 00:00:04,000\n첫 자막\n둘째 줄\n\n2\n00:00:04,000 --> 00:01:04,000\n다음 장면\n");
  });
  it("rejects duplicate scene IDs and invalid lengths", () => {
    const id="00000000-0000-4000-8000-000000000001";
    expect(videoProjectSchema.safeParse({scenes:[{id},{id}]}).success).toBe(false);
    expect(videoProjectSchema.safeParse({scenes:[{id,duration:0}]}).success).toBe(false);
  });
});
