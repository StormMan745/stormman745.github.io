// Read-only boundary checks against the deployed functions. No user credentials.
const assert=require('node:assert/strict');
const endpoint='https://qexiyikdmdbdxgusqnee.supabase.co/functions/v1/';
const key='sb_publishable_HSR87zEuGFNjwEYoa-zrSw_cTWchorw';
(async()=>{
 for(const [slug,body,expected,origin] of [
  ['petcare-platform',{action:'backups'},401],
  ['petcare-platform',{action:'share-view',token:'x'.repeat(43)},404],
  ['petcare-platform',{action:'maintenance'},401],
  ['petcare-platform',{action:'share-view',token:'x'.repeat(43)},403,'https://foreign.example'],
  ['petcare-assistant',{action:'profile-status'},401],
  ['petcare-push-reminders',{},401]
 ]){
  const response=await fetch(endpoint+slug,{method:'POST',headers:{apikey:key,'Content-Type':'application/json',Origin:origin||'https://stormman745.github.io'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,expected,slug+' '+body.action);console.log('PASS',slug,body.action||'anonymous',response.status);
 }
})().catch(error=>{console.error(error.message);process.exitCode=1});
