import pg from "pg";
import { writeFileSync } from "node:fs";
import { fetchPublisherArticle } from "../server/services/publisherLookup";
import { safeFetch } from "../server/services/safeFetch";
const client=new pg.Client({connectionString:process.env.APP_DATABASE_URL,connectionTimeoutMillis:8000});
const expected=new Map([[3429,"포천청소년문화의집, ‘청소년역사기행’ 참가자 모집"],[3410,"사천 청소년 꿈캠프 참가자 모집…11월 28일 진로 체험"]]);
const report:any={checkedAt:new Date().toISOString(),environment:"GitHub Actions; not Render",googleRequests:0,paidAiCalls:0,draftsModified:0,posts:0,recovered:0,results:[]};
try{
 await client.connect();await client.query("BEGIN READ ONLY");await client.query("SET LOCAL statement_timeout='8s'");
 const {rows}=await client.query("SELECT id,title,original_url,fetch_status,fetched_text,meta FROM source_documents WHERE id=ANY($1::int[]) AND is_sample=false",[[...expected.keys()]]);await client.query("ROLLBACK");
 for(const doc of rows){
  if(expected.get(doc.id)!==doc.title)throw new Error('Unexpected source identity');
  const calls:string[]=[];
  const fetcher:typeof safeFetch=async(url,options)=>{if(new URL(url).hostname.endsWith('google.com')){report.googleRequests++;throw new Error('Google requests forbidden by diagnostic');}calls.push(url);return safeFetch(url,options);};
  const r=await fetchPublisherArticle(doc.original_url,fetcher,{title:doc.title,publisherUrl:doc.meta.publisherUrl});
  const result:any={id:doc.id,title:doc.title,ok:r.ok,calls};
  if(r.ok){
    Object.assign(result,{url:r.finalUrl,characters:r.text.length,start:r.text.slice(0,240),end:r.text.slice(-240),hash:r.hash});
    if(process.env.REPAIR_SOURCES==='true' && !doc.fetched_text){
      await client.query('BEGIN');
      try{
        await client.query("SET LOCAL statement_timeout='8s'");
        const saved=await client.query(`UPDATE source_documents SET fetched_text=$1,content_hash=$2,fetch_status='ok',fetch_error=NULL,last_fetched_at=now(),updated_at=now(),attachments=$3::jsonb,meta=meta||$4::jsonb WHERE id=$5 AND title=$6 AND original_url=$7 AND fetched_text IS NULL AND fetch_status IN ('blocked','failed','unsupported') RETURNING id`,[r.text,r.hash,JSON.stringify(r.attachments),JSON.stringify({finalUrl:r.finalUrl,fetchUrl:r.finalUrl,pageTitle:r.title,acquisition:'publisher_exact_headline',recoveredAt:new Date().toISOString()}),doc.id,doc.title,doc.original_url]);
        if(saved.rowCount){
          await client.query("UPDATE content_items SET evidence_status='needs_review',updated_at=now() WHERE primary_source_id=$1 AND evidence_status='fetch_failed'",[doc.id]);
          await client.query("INSERT INTO audit_logs(actor,action,entity,entity_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)",['operator-maintenance','recover_publisher_source','source_document',String(doc.id),JSON.stringify({url:r.finalUrl,characters:r.text.length,method:'publisher_exact_headline',googleRequests:0,draftsModified:0})]);
          report.recovered++;result.saved=true;
        }
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');throw e;}
    }
  }else{Object.assign(result,{status:r.status,error:r.error});}
  report.results.push(result);
 }
}catch(e){report.error=(e as Error).message;process.exitCode=1;}
finally{await client.end().catch(()=>{});writeFileSync('publisher-recovery.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
