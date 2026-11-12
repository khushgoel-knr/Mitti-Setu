// Continuous user-controlled recording. Short independent containers keep each
// upload small enough for serverless hosting; there is no total-duration cutoff.
let voiceRecording=false,voiceClips=[],voiceResults=[],voiceTarget='listing';
function discardVoice(){
 voiceGeneration++;voiceRecording=false;clearTimeout(voiceTimer);voiceTimer=null;
 if(voiceRecorder){voiceRecorder.onstop=null;voiceRecorder.ondataavailable=null;voiceRecorder.onerror=null;if(voiceRecorder.state!=='inactive')voiceRecorder.stop()}
 voiceStream?.getTracks().forEach(track=>track.stop());voiceStream=null;voiceRecorder=null;voiceBlob=null;voiceClips=[];voiceResults=[];voiceForm=null;voiceBusy=false;
 if(voiceURL)URL.revokeObjectURL(voiceURL);voiceURL='';
}
function clearVoiceAudio(){discardVoice();if($('#voice-playback'))$('#voice-playback').replaceChildren();if($('#voice-status'))$('#voice-status').textContent='';const b=$('[data-action="assistRecord"]');if(b)b.textContent=t('record')}
function showVoicePlayback(){
 const target=$('#voice-playback');if(!target||!voiceClips.length)return;const clips=[...voiceClips],select=document.createElement('select'),audio=document.createElement('audio');select.setAttribute('aria-label',t('voicePart'));audio.controls=true;
 clips.forEach((_,i)=>{const option=document.createElement('option');option.value=i;option.textContent=t('voicePart')+' '+(i+1)+' / '+clips.length;select.append(option)});
 const play=()=>{if(voiceURL)URL.revokeObjectURL(voiceURL);voiceURL=URL.createObjectURL(clips[Number(select.value)]);audio.src=voiceURL};select.addEventListener('change',play);target.replaceChildren(select,audio);play();
}
async function toggleVoiceRecording(){
 if(voiceRecording){voiceRecording=false;voiceBusy=true;clearTimeout(voiceTimer);if(voiceRecorder?.state==='recording')voiceRecorder.stop();return}
 if(voiceBusy)return;const form=$('#monitor-form')||$('#crop-form');if(!form)return;clearVoiceAudio();voiceForm=form;voiceTarget=form.id==='monitor-form'?'monitor':'listing';const generation=voiceGeneration;
 if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){$('#voice-status').textContent=t('voiceUnavailable');return}
 voiceBusy=true;
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});if(generation!==voiceGeneration||!form.isConnected||!$('#modal').open){stream.getTracks().forEach(track=>track.stop());return}
  voiceStream=stream;const mime=['audio/webm','audio/mp4','audio/ogg'].find(type=>MediaRecorder.isTypeSupported(type));if(!mime)throw Error('unsupported');voiceRecording=true;voiceBusy=false;
  const finish=()=>{stream.getTracks().forEach(track=>track.stop());voiceBusy=false;showVoicePlayback();if(form.isConnected){$('#voice-status').textContent=t('audioReady');$('[data-action="assistRecord"]').textContent=t('record')}};
  const startPart=()=>{
   if(generation!==voiceGeneration||!form.isConnected)return;const chunks=[];voiceRecorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:48000});
   voiceRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
   voiceRecorder.onerror=()=>{clearVoiceAudio();if(form.isConnected)$('#voice-status').textContent=t('voiceUnavailable')};
   voiceRecorder.onstop=()=>{clearTimeout(voiceTimer);if(generation!==voiceGeneration||!form.isConnected){stream.getTracks().forEach(track=>track.stop());return}const clip=new Blob(chunks,{type:mime});if(clip.size)voiceClips.push(clip);if(voiceRecording){$('#voice-status').textContent=t('recording')+' · '+voiceClips.length+' '+t('voicePart');startPart()}else finish()};
   voiceRecorder.start();voiceTimer=setTimeout(()=>{if(voiceRecorder?.state==='recording')voiceRecorder.stop()},20000);
  };
  $('[data-action="assistRecord"]').textContent=t('stopRecord');$('#voice-status').textContent=t('recording');startPart();
 }catch{voiceBusy=false;voiceRecording=false;voiceStream?.getTracks().forEach(track=>track.stop());if(form.isConnected)$('#voice-status').textContent=t('micDenied')}
}
function applyVoiceFields(form,result){
 let filled=0;for(const [key,value]of Object.entries(result.fields)){const field=form.elements.namedItem(key);if(value!==null&&value!==''&&field){if(key==='place'&&form.id==='monitor-form'){form.elements.latitude.value='';form.elements.longitude.value='';$('#monitor-location-results').replaceChildren()}field.value=String(value);filled++}}
 if(form.id==='crop-form'){
  if(result.fields.kind&&!result.fields.category)form.elements.category.value=result.fields.kind==='rice'?'grains':['mango','banana'].includes(result.fields.kind)?'fruits':'vegetables';
  $('#quality-value').textContent=form.elements.quality.value;$('#harvested-date').min=form.elements.cultivatedDate.value||'1900-01-01';if(!cropDraftPhoto)$('#listing-preview').innerHTML=cropVisual({kind:form.elements.kind.value,name:form.elements.name.value});
 }return filled;
}
async function fillVoiceDraft(){
 const form=$('#monitor-form')||$('#crop-form');if(!form||voiceBusy)return;if(voiceRecording)throw Error(t('stopFirst'));
 const text=$('#voice-text').value.trim();if(!voiceClips.length&&!text)throw Error(t('draftNeedsInput'));
 const generation=voiceGeneration,button=$('[data-action="assistFill"]'),target=form.id==='monitor-form'?'/api/monitor/draft':'/api/assistant/draft';voiceBusy=true;button.disabled=true;
 const clips=[...voiceClips],texts=text.match(/[\s\S]{1,1600}(?:\s|$)|[\s\S]{1,1600}/g)||[],count=clips.length||texts.length,merged={transcript:'',fields:{}};
 try{
  for(let i=0;i<count;i++){
   if(generation!==voiceGeneration||!form.isConnected)return;$('#voice-status').textContent=t('voiceProgress')+' '+(i+1)+' / '+count;
   let result=clips.length?voiceResults[i]:null;
   if(!result){const audio=clips.length?await audioAsWav(clips[i]):undefined;result=await api(target,'POST',{audio,text:clips.length?undefined:texts[i],context:clips.length?merged.transcript.slice(-500):undefined,language:lang});if(generation!==voiceGeneration||!form.isConnected)return;if(clips.length)voiceResults[i]=result}
   merged.transcript+=(merged.transcript?'\n':'')+result.transcript;for(const [k,v]of Object.entries(result.fields))if(v!==null&&v!=='')merged.fields[k]=v;
  }
  if(generation!==voiceGeneration||!form.isConnected)return;const filled=applyVoiceFields(form,merged);if(merged.transcript)$('#voice-text').value=merged.transcript;
  voiceClips=[];voiceResults=[];$('#voice-status').textContent=t(filled?(form.id==='monitor-form'?'monitorDraftReview':'draftReview'):'draftEmpty');
 }catch(e){if(form.isConnected)$('#voice-status').textContent=e.message+(clips.length?' '+t('voiceRetry'):'')}finally{if(generation===voiceGeneration){voiceBusy=false;if(button.isConnected)button.disabled=false}}
}
