// Channel switching and creation regression against the built app. Run after npm run build.
// CI requires WebKit; local systems may fall back using WORKSPACE_BROWSER_EXECUTABLE.
// Every API response is synthetic;
// external requests are blocked, and no database, AI provider or social account is used.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { preview } from "vite";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch {
  playwright = require(require.resolve("playwright", { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?? "/nonexistent"] }));
}
const outputDir = path.resolve("test-results/channel-navigation");
await mkdir(outputDir, { recursive: true });
await writeFile(`${outputDir}/results.json`, "[]");
const server = await preview({ preview: { host: "127.0.0.1", port: 4176, strictPort: true } });
const origin = "http://127.0.0.1:4176";
const itemPath = "/api/channels/3/items/9790";
const copyPath = `${itemPath}/card-copy`;
const stamp = "2026-11-03T00:00:00.000Z";
const clone = value => structuredClone(value);
const channels = [{ id: 3, slug: "current-dialogue", name: "Alligodang", active: true, version: 1, accentColor: "#32756b", contentType: "current_dialogue", budget: {} }];
const ai = { defaultProvider: "gemini", text: { gemini: true, openai: false, anthropic: false }, image: false };
const initialCopy = () => ({
  version: 1, templateKey: "set:n04",
  cover: { title: "뉴스를 읽는 가족의 시간", subtitle: "원문을 확인하고 함께 질문해요" },
  pages: Array.from({ length: 4 }, (_, index) => ({ id: `body-${index + 1}`, title: ["무슨 일이 있었나요?", "확인된 사실", "함께 생각할 질문", "오늘의 대화"][index], subtitle: "가족과 나누는 뉴스", body: `원문에서 확인한 내용을 정리한 ${index + 1}번째 카드입니다. 사실과 의견을 구분하며 이야기를 나눠 보세요.` })),
});

const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const wrap = (value, length) => String(value).split("\n").flatMap(line => {
  const chars = [...line], lines = [];
  for (let index = 0; index < chars.length; index += length) lines.push(chars.slice(index, index + length).join(""));
  return lines.length ? lines : [""];
});
const imageCache = new Map();
async function cardImage(copy, pageIndex) {
  const key = JSON.stringify([copy, pageIndex]);
  if (imageCache.has(key)) return imageCache.get(key);
  const page = pageIndex ? copy.pages[pageIndex - 1] : copy.cover;
  const text = (value, x, y, size, color, width, weight = 400) => wrap(value, width).slice(0, 8).map((line, index) => `<text x="${x}" y="${y + index * size * 1.45}" font-size="${size}" fill="${color}" font-weight="${weight}">${escapeXml(line)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#f5f3ea"/><rect x="0" y="0" width="1080" height="24" fill="#32756b"/><g font-family="Pretendard">${text("ALLIGODANG / FAMILY NEWS", 80, 120, 28, "#32756b", 34, 600)}${text(page.title, 80, 290, 76, "#172f30", 12, 700)}${text(page.subtitle, 80, 610, 34, "#536a66", 24)}${text(pageIndex ? page.body : "오늘의 뉴스를 가족의 대화로 이어 보세요.", 80, 800, 42, "#233e3c", 21)}<line x1="80" x2="1000" y1="1230" y2="1230" stroke="#c7d4cc"/>${text("우주펭귄상회 스튜디오 · 브라우저 테스트 자료", 80, 1290, 24, "#536a66", 44)}<text x="1000" y="1290" text-anchor="end" font-size="24" fill="#32756b">${pageIndex + 1} / 5</text></g></svg>`;
  const png = new Resvg(svg, { font: { fontFiles: [path.resolve("assets/fonts/Pretendard-Regular.ttf"), path.resolve("assets/fonts/Pretendard-Bold.ttf")], loadSystemFonts: false, defaultFontFamily: "Pretendard" } }).render().asPng();
  const bytes = await sharp(png).resize(540, 675).jpeg({ quality: 88 }).toBuffer();
  imageCache.set(key, bytes);
  return bytes;
}

function fixture() {
  const state = { publicationDraft: { version: 1, captions: { instagram: "아이와 함께 오늘의 뉴스를 읽고 서로의 질문을 나눠 보세요.", telegram: "" }, options: { destinationIds: [20], timing: "now", scheduledAtKst: "" } }, saved: { version: 3, revisionId: 30, hasSavedCopy: true, copy: initialCopy() }, reviewStatus: "reviewed", cards: [], approvals: [], deliveries: [], writes: [], aiAttempts: 0, nextAssetId: 701 };
  const assetCopies = new Map();
  const makeAsset = () => {
    const id = state.nextAssetId; state.nextAssetId += 10;
    const copy = clone(state.saved.copy);
    const asset = { id, revisionId: state.saved.revisionId, templateKey: copy.templateKey, source: "builtin", createdAt: stamp, carousel: { version: 1, altVersion: 1, cover: { kind: "typography", credit: "원문에 근거한 카드 · 테스트 자료" }, pages: [copy.cover, ...copy.pages].map((page, index) => ({ id: id + index, title: page.title, sha256: `fixture-${id + index}`, altText: `${page.title} 내용을 설명하는 카드입니다.` })) } };
    asset.carousel.pages.forEach((page, index) => assetCopies.set(page.id, { copy, index }));
    state.cards.unshift(asset);
    return asset;
  };
  makeAsset();
  const detail = () => {
    const payload = { title: state.saved.copy.cover.title, event_at: null, published_at: stamp, checked_at: stamp, summary: "지역의 새로운 과학 소식을 가족과 함께 읽습니다.", why_it_matters: "확인한 사실과 질문을 구분하는 연습을 합니다.", verified_facts: ["지역 과학 프로그램이 열립니다."], under_verification: [], perspectives: [], discussion_questions: ["무엇을 알게 되었나요?", "어떤 근거가 있나요?", "더 확인할 점은 무엇인가요?"], glossary: [], parent_hints: [], sources: [], evidence: [], independent_source_count: 1, cardCopy: clone(state.saved.copy) };
    return {
      item: { id: 9790, channelId: 3, primarySourceId: 901, title: "뉴스를 읽는 가족의 시간", kind: "current_dialogue", origin: "collected", version: state.saved.version, currentRevisionId: state.saved.revisionId, reviewStatus: state.reviewStatus, evidenceStatus: "needs_review", relevance: "relevant", publishStatus: "waiting", excluded: false, edited: payload, canvaDesign: null, createdAt: stamp, updatedAt: stamp, subcategory: null },
      current: { id: state.saved.revisionId, revisionNo: state.saved.revisionId - 27, author: "operator", payload, createdAt: stamp },
      primary: { id: 901, title: "가족과 함께 읽는 과학 프로그램 소식", originalUrl: "https://source.example/article", normalizedUrl: "https://source.example/article", kind: "rss_direct", publisher: "테스트 과학신문", fetchStatus: "ok", fetchedText: "지역 과학 프로그램이 열립니다. 공개된 안내문에서 일정을 확인하고, 참가 조건은 공식 자료를 다시 확인해 주세요. 이 본문은 브라우저 테스트를 위한 합성 자료입니다.", snippet: "가족과 나누는 과학 뉴스", publishedAt: stamp, publishedPrecision: "day", lastFetchedAt: stamp, attachments: [], meta: {}, isSample: false },
      linked: [], revisions: [{ id: state.saved.revisionId, revisionNo: state.saved.revisionId - 27, author: "operator", payload, createdAt: stamp }], cards: clone(state.cards), approvals: clone(state.approvals), deliveries: clone(state.deliveries), similar: [], publicationDraft: clone(state.publicationDraft), defaultCaptions: { instagram: "아이와 함께 오늘의 뉴스를 읽고 서로의 질문을 나눠 보세요.", telegram: "" },
      publicationReadiness: { ready: true, blockers: [], dryRun: false, autoPublish: true, dailyLimit: 10, expectedUsername: "alligodang.official", destinations: [{ id: 20, label: "@alligodang.official", platform: "instagram", configured: true }] },
    };
  };
  // current-dialogue stores its Studio channel as "news" (shared/channelKeys.ts).
  // The account's display name and Instagram handle are not the saved channel key.
  const studio = () => ({ card: { id: 25, version: 2, title: detail().item.title, channel: "news", format: "카드뉴스", stage: "review", sourceItemId: 9790, script: "", caption: "", memo: "", imagePath: "", panels: Array.from({ length: 4 }, () => ({ scene: "", dialogue: "", imageId: null })), createdAt: stamp, updatedAt: stamp, sourceOutput: { assetId: state.cards[0].id, channelId: 3, itemId: 9790, revisionId: state.cards[0].revisionId, stale: state.cards[0].revisionId !== state.saved.revisionId, pages: state.cards[0].carousel.pages, coverCredit: "테스트 자료" } }, revisions: [], jobs: [], images: [] });
  async function api(route, url) {
    const request = route.request(), pathname = url.pathname, method = request.method();
    const body = request.postData() ? request.postDataJSON() : undefined;
    if (method !== "GET") state.writes.push({ path: pathname, method, body: clone(body) });
    let data;
    if (pathname === "/api/auth/me") data = { user: "fixture", demo: false, csrf: "fixture-csrf", recoveryScope: "fixture-recovery-scope-20261104", authConfigured: true, demoAllowed: false };
    else if (pathname === "/api/channels") data = channels;
    else if (pathname === "/api/channels/3/today") data = { counts: { pendingReview: 1, draftsReady: 1 } };
    else if (pathname === "/api/status") data = { globalStop: false, workerConnected: true, integrations: { aiProvider: "gemini", gemini: true, openai: false, anthropic: false, flags: { dryRun: false, autoPublish: true } } };
    else if (pathname === "/api/studio/ai-status") data = ai;
    else if (pathname === "/api/canva/status") data = { connected: false };
    else if (pathname === "/api/studio/cards/25") data = studio();
    else if (pathname === "/api/studio/cards") data = { cards: [studio().card], ai, notes: "", notesVersion: 1 };
    else if (pathname === "/api/channels/3/templates") data = { current: "set:n04", items: [{ key: "set:n04", name: "뉴스 브리핑", description: "원문에서 시작하는 가족의 뉴스", kind: "builtin", family: "news", pageCount: 5 }] };
    else if (pathname === itemPath && method === "GET") data = detail();
    else if (pathname === copyPath && method === "GET") data = clone(state.saved);
    else if (pathname === `${copyPath}/preview` && method === "POST") {
      return route.fulfill({ contentType: "image/jpeg", body: await cardImage(body.copy, body.page) });
    }
    else if (/^\/api\/channels\/3\/media\/\d+\/alt-text$/.test(pathname)) data = { version: 1, values: Array.from({ length: 5 }, (_, index) => `뉴스의 확인된 사실을 설명하는 ${index + 1}번째 카드입니다.`) };
    else if (/^\/api\/channels\/3\/media\/\d+$/.test(pathname)) {
      const image = assetCopies.get(Number(pathname.split("/").at(-1)));
      assert(image, "unknown synthetic media id");
      return route.fulfill({ contentType: "image/jpeg", body: await cardImage(image.copy, image.index) });
    } else return false;
    await route.fulfill({ json: data });
    return true;
  }
  return { state, api };
}

const field = (page, suffix) => page.locator(`.card-copy-editor textarea[id$="-${suffix}"]`);
const mutations = state => state.writes.filter(write => !write.path.endsWith("/preview"));
async function ready(page) {
  await field(page, "title").waitFor();
  assert.equal(await page.locator(".content-workspace .card-copy-editor").count(), 1);
  assert.equal(await page.locator('.content-workspace [role="tablist"]').count(), 0);
}
async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll("main *")].filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right > innerWidth + 1; }).slice(0, 8).map(node => ({ tag: node.tagName, class: node.className, width: node.getBoundingClientRect().width })) }));
  assert(dimensions.scroll <= dimensions.width + 1, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
  for (const input of await page.locator(".card-copy-fields textarea").all()) {
    const box = await input.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= dimensions.width + 1, `${label}: text field outside viewport`);
  }
}
let browser;
let browserEngine = "webkit";
async function launchBrowser() {
  try { return await playwright.webkit.launch(); }
  catch (webkitError) {
    // CI installs WebKit and its OS dependencies. Never silently weaken that gate.
    if (process.env.CI) throw webkitError;
    browserEngine = "chromium";
    console.log(`WebKit unavailable; using Chromium (${String(webkitError.message).split("\n")[0]})`);
    return playwright.chromium.launch({ ...(process.env.WORKSPACE_BROWSER_EXECUTABLE ? { executablePath: process.env.WORKSPACE_BROWSER_EXECUTABLE, args: ["--no-zygote", "--disable-dev-shm-usage"] } : {}) });
  }
}
const widths = process.env.WORKSPACE_BROWSER_WIDTHS ? process.env.WORKSPACE_BROWSER_WIDTHS.split(",").map(Number) : [393, 1280];
assert(widths.length && widths.every(width => Number.isInteger(width) && width >= 280), "WORKSPACE_BROWSER_WIDTHS must be comma-separated viewport widths");
const out = [];
try {
 browser = await launchBrowser();
 for (const width of widths) {
  const context=await browser.newContext({viewport:{width,height:900},locale:"ko-KR",timezoneId:"Asia/Seoul",serviceWorkers:"block"});
  await context.addInitScript(()=>localStorage.setItem("spacepenguin.channel","3"));
  const page=await context.newPage(), f=fixture(), errors=[], blocked=[], creates=[], aiSettingSaves=[];
  const completeChannel={...channels[0],description:"",audience:"일반 독자",editorialGuide:"",categories:null,aiSettings:null,aiDefaultModels:{gemini:"gemini-default",openai:"gpt-default",anthropic:"claude-default",image:"gpt-image-default"},aiAvailability:{gemini:true,openai:false,anthropic:false},cardTemplate:"set:n04",budget:{naverCallsPerRun:3,resultsPerRun:10,fetchTargetsPerRun:5,fetchCallsPerRun:10,llmCallsPerRun:3,dailyPublishLimit:0}};
  const directory=[completeChannel,{...completeChannel,id:4,slug:"new-brand",name:"직접 추가한 브랜드",categories:[]}];
  page.on("pageerror",e=>errors.push(e.message));
  await context.route("**/*",async route=>{
   const url=new URL(route.request().url()), method=route.request().method();
   if(url.origin!==origin){blocked.push(url.href);return route.abort();}
   if(!url.pathname.startsWith("/api/"))return route.continue();
   if(url.pathname==="/api/channels") {
     if(method==="POST") { const body=route.request().postDataJSON(); creates.push(clone(body)); const next={...completeChannel,...body,id:9,active:true,version:1}; directory.push(next);return route.fulfill({json:next}); }
     return route.fulfill({json:directory});
   }
   if(url.pathname==="/api/channels/9" && method==="PATCH") {
     const body=route.request().postDataJSON(),index=directory.findIndex(channel=>channel.id===9);
     assert.equal(body.version,directory[index].version,"AI settings save must carry the current version");
     aiSettingSaves.push(clone(body.aiSettings));
     directory[index]={...directory[index],...body,version:directory[index].version+1};
     return route.fulfill({json:directory[index]});
   }
   if(/^\/api\/channels\/(4|9)\/today$/.test(url.pathname))return route.fulfill({json:{counts:{pendingReview:0}}});
   if(/^\/api\/channels\/\d+\/destinations$/.test(url.pathname))return route.fulfill({json:{items:[],defaults:{}}});
   if(url.pathname==="/api/studio/instagram/accounts")return route.fulfill({json:{accounts:directory.map(ch=>({channelId:ch.id,channelName:ch.name,channelSlug:ch.slug,expectedUsername:ch.id===3?"alligodang.official":"",destinations:[]}))}});
   const wrapped={request:()=>route.request(),fulfill:async response=>{
    if(url.pathname==="/api/studio/cards") response.json.cards.push({...clone(response.json.cards[0]),id:26,channel:"new-brand",title:"두 번째 브랜드의 콘텐츠"});
    return route.fulfill(response);
   }};
   try { if(await f.api(wrapped,url)!==false)return; }catch(e){errors.push(e.message);}
   errors.push("Unmocked API "+url.pathname);return route.fulfill({status:404,json:{error:"fixture"}});
  });
  try {
    await page.goto(origin);await page.locator('a[href="/studio/25"]').first().waitFor();
    const selection=page.getByLabel("보기 채널",{exact:true});
    await selection.selectOption("4");await page.locator('a[href="/studio/26"]').first().waitFor();
    const listWorks=await page.locator('a[href="/studio/25"]').count()===0;
    await selection.selectOption("3");await page.locator('a[href="/studio/25"]').first().click();await ready(page);
    await field(page,"title").fill("채널을 바꾸기 전에 작성한 미저장 원고");
    await selection.selectOption("4");
    const dialog=page.getByRole("dialog",{name:"저장하지 않은 변경이 있습니다"});
    await dialog.waitFor();assert.equal(await selection.inputValue(),"3");assert.equal(new URL(page.url()).pathname,"/studio/25");
    await dialog.getByRole("button",{name:"머무르기",exact:true}).click();
    assert.equal(await field(page,"title").inputValue(),"채널을 바꾸기 전에 작성한 미저장 원고");
    await selection.selectOption("4");await dialog.waitFor();await dialog.getByRole("button",{name:"버리고 이동",exact:true}).click();
    await page.locator('a[href="/studio/26"]').first().waitFor();
    assert.equal(new URL(page.url()).pathname,"/");assert.equal(await selection.inputValue(),"4");
    assert.equal(f.state.saved.copy.cover.title,"뉴스를 읽는 가족의 시간");
    assert.equal(await page.locator('a[href="/studio/25"]').count(),0);
    await noOverflow(page,"channel-switched");
    await page.screenshot({path:`${outputDir}/after-channel-${width}.png`});
    const settings=width<768?page.locator('.mobile-nav a[href="/settings"]'):page.locator('.sidebar a[href="/settings"]');
    await settings.click();await page.locator(".page-head").getByRole("button",{name:"＋ 새 채널 추가",exact:true}).click();
    await page.getByLabel("채널명",{exact:true}).fill("테스트로 만든 동네 채널");
    await page.getByLabel("주로 만들 콘텐츠").selectOption("notice");
    await page.getByLabel("소분류",{exact:false}).fill("행사 안내\n생활 정보");
    await page.getByText("추가 설정 · 대상과 채널 주소",{exact:true}).click();
    await page.getByLabel("채널 주소",{exact:false}).fill("neighborhood");
    await noOverflow(page,"new-channel-form");
    await page.screenshot({path:`${outputDir}/new-channel-${width}.png`});
    await page.getByRole("button",{name:"채널 추가",exact:true}).click();
    await page.getByText("‘테스트로 만든 동네 채널’ 채널을 추가했습니다.",{exact:false}).waitFor();
    assert.equal(creates.length,1);assert.equal(creates[0].contentType,"notice");assert.deepEqual(creates[0].categories,["행사 안내","생활 정보"]);assert.equal(creates[0].slug,"neighborhood");
    assert.equal(await selection.locator('option[value="9"]').textContent(),"테스트로 만든 동네 채널");
    await noOverflow(page,"created-channel-form");
    await page.screenshot({path:`${outputDir}/created-channel-${width}.png`});
    assert.equal(await page.getByLabel("기사 요약 AI",{exact:true}).inputValue(),"gemini");
    assert.equal(await page.getByLabel("카드뉴스 문구 AI",{exact:true}).inputValue(),"openai");
    assert.equal(await page.getByLabel("이미지 제작 AI",{exact:true}).inputValue(),"openai");
    await page.getByLabel("기사 요약 모델 ID",{exact:true}).fill("gemini-browser-summary");
    await page.getByLabel("카드뉴스 문구 모델 ID",{exact:true}).fill("gpt-browser-copy");
    await page.getByLabel("이미지 제작 모델 ID",{exact:true}).fill("gpt-image-browser");
    await noOverflow(page,"channel-ai-role-models");
    await page.getByRole("heading",{name:"역할별 AI",exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:`${outputDir}/channel-ai-roles-${width}.png`});
    await page.getByRole("button",{name:"채널 설정 저장",exact:true}).click();
    await page.getByRole("status").filter({hasText:"채널 설정 저장됨"}).waitFor();
    assert.deepEqual(aiSettingSaves,[{summary:{provider:"gemini",model:"gemini-browser-summary"},copy:{provider:"openai",model:"gpt-browser-copy"},image:{provider:"openai",model:"gpt-image-browser"}}]);
    assert.equal(directory.find(channel=>channel.id===4).aiSettings,null,"another channel's AI must remain unchanged");
    await page.getByRole("button",{name:"이 채널 콘텐츠 보기",exact:true}).click();
    await page.waitForURL(origin+"/");assert.equal(await selection.inputValue(),"9");
    assert.equal(await page.locator('a[href="/studio/25"]').count(),0);assert.equal(await page.locator('a[href="/studio/26"]').count(),0);
    await noOverflow(page,"created-channel-list");
    assert(listWorks);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(mutations(f.state),[],"channel switching must not save, generate or publish a discarded draft");
    const result={width,browserEngine,listWorks,dirtyCancelledPreserved:true,explicitDiscardNavigated:true,newChannelCreated:true,newChannelSelected:true,roleAiDefaults:true,roleModelsSaved:true,creates,aiSettingSaves,errors,blocked};
    out.push(result);await writeFile(`${outputDir}/results.json`,JSON.stringify(out,null,2));console.log(JSON.stringify(result));
  } catch(error) { await page.screenshot({path:`${outputDir}/after-failure-${width}.png`});await writeFile(`${outputDir}/after-failure-${width}.json`,JSON.stringify({errors,blocked,url:page.url(),creates},null,2));throw error; }
  finally {await context.close();}
 }
} finally {await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve));}
