let createWorker, pdfjsLib, pipeline, env;
let libsPromise;
function loadLibraries(){
  if(libsPromise) return libsPromise;
  libsPromise = Promise.all([
    import("https://cdn.jsdelivr.net/npm/tesseract.js@7/+esm"),
    import("https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.mjs"),
    import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/+esm")
  ]).then(([t,p,h])=>{
    createWorker=t.createWorker;
    pdfjsLib=p;
    pipeline=h.pipeline;
    env=h.env;
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.worker.mjs";
    env.allowLocalModels=false;
    env.useBrowserCache=true;
  });
  return libsPromise;
}

const $ = id => document.getElementById(id);
const state = { file:null, stop:false, pages:[], chunks:0, totalPages:0 };

$("chooseBtn").addEventListener("click",(e)=>{
  e.preventDefault();
  $("fileInput").click();
});
$("dropZone").addEventListener("click",(e)=>{
  if(e.target.closest("button") || e.target.closest("input")) return;
  $("fileInput").click();
});
$("fileInput").onchange=e=>selectFile(e.target.files[0]);
$("dropZone").ondragover=e=>{e.preventDefault();$("dropZone").classList.add("drag")};
$("dropZone").ondragleave=()=>$("dropZone").classList.remove("drag");
$("dropZone").ondrop=e=>{e.preventDefault();$("dropZone").classList.remove("drag");selectFile(e.dataTransfer.files[0])};
$("stopBtn").onclick=()=>{state.stop=true; setStatus("Stopping…","Finishing current operation safely.")};

function selectFile(file){
  if(!file)return;
  const ok=/\\.pdf$|\\.jpe?g$/i.test(file.name);
  if(!ok){alert("Please select a PDF, JPG or JPEG file.");return}
  state.file=file;$("fileInfo").textContent=`${file.name} • ${(file.size/1024/1024).toFixed(2)} MB`;
  $("startBtn").disabled=false;
}

$("startBtn").onclick=run;
$("downloadTxt").onclick=downloadTxt;
$("printBtn").onclick=()=>window.print();

function setStatus(a,b=""){ $("status").textContent=a; $("detail").textContent=b; }
function progress(n,total){const p=total?Math.round(n/total*100):0;$("bar").style.width=p+"%";$("percent").textContent=p+"%"}
function showProgress(){ $("progressCard").classList.remove("hidden"); $("resultCard").classList.add("hidden"); }
function err(msg){$("detail").innerHTML=`<div class="error">${escapeHtml(msg)}</div>`}

async function run(){
  state.stop=false;state.pages=[];state.chunks=0;$("chunks").textContent="0";
  $("startBtn").disabled=true;$("stopBtn").disabled=false;showProgress();progress(0,1);
  try{
    setStatus("Loading browser components…","Preparing PDF/OCR/translation engines…");
    await loadLibraries();
    const direction=$("direction").value;
    setStatus("Loading translation engine…","The first run can take several minutes because the model is downloaded and cached.");
    const translator=await getTranslator(direction);
    if(state.stop)throw new Error("Stopped by user.");

    if(/\\.pdf$/i.test(state.file.name)){
      await processPDF(state.file,translator);
    }else{
      state.totalPages=1;$("totalPages").textContent="1";
      await processImage(state.file,translator);
    }
    renderResults();
    setStatus("Completed",`Translated ${state.pages.length} page(s).`);
    progress(1,1);
  }catch(e){console.error(e);err(e?.message||String(e));}
  finally{$("startBtn").disabled=false;$("stopBtn").disabled=true}
}

async function getTranslator(direction){
  const model=direction==="en-hi" ? "Xenova/opus-mt-en-hi" : "Xenova/opus-mt-hi-en";
  // The model is open and runs locally in the browser through Transformers.js.
  return await pipeline("translation",model,{dtype:"q8"});
}

async function processPDF(file,translator){
  const bytes=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
  state.totalPages=pdf.numPages;$("totalPages").textContent=pdf.numPages;
  const mode=$("mode").value, scale=parseFloat($("ocrScale").value);
  const worker=await createWorker($("direction").value==="en-hi"?"eng":"hin",1);
  try{
    for(let i=1;i<=pdf.numPages;i++){
      if(state.stop)break;
      setStatus(`Processing page ${i} of ${pdf.numPages}`,"Extracting text…");
      const page=await pdf.getPage(i);
      let text="";
      if(mode!=="ocr"){
        const content=await page.getTextContent();
        text=content.items.map(x=>x.str).join(" ").replace(/\\s+/g," ").trim();
      }
      // Scanned/poor-text pages fall back to OCR.
      if(mode==="ocr" || text.length<40){
        setStatus(`OCR page ${i} of ${pdf.numPages}`,"Rendering page and recognizing text…");
        const viewport=page.getViewport({scale});
        const canvas=document.createElement("canvas");
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
        const r=await worker.recognize(canvas);
        text=r.data.text||"";
        canvas.width=canvas.height=1;
      }
      setStatus(`Translating page ${i} of ${pdf.numPages}`,"Splitting into safe chunks…");
      const translated=await translateLong(text,translator);
      state.pages.push({page:i,original:text,translated});
      $("donePages").textContent=state.pages.length;
      progress(i,pdf.numPages);
    }
  }finally{await worker.terminate()}
}

async function processImage(file,translator){
  const worker=await createWorker($("direction").value==="en-hi"?"eng":"hin",1);
  try{
    setStatus("OCR image","Recognizing text…");
    const r=await worker.recognize(file);
    const text=r.data.text||"";
    const translated=await translateLong(text,translator);
    state.pages.push({page:1,original:text,translated});
    $("donePages").textContent="1";progress(1,1);
  }finally{await worker.terminate()}
}

function splitText(text,max=900){
  text=(text||"").replace(/\\r/g,"").trim();
  if(!text)return[];
  const paras=text.split(/\\n{2,}/).map(x=>x.trim()).filter(Boolean);
  const out=[];
  for(const p of paras){
    if(p.length<=max){out.push(p);continue}
    const sentences=p.split(/(?<=[.!?।॥])\\s+/);
    let cur="";
    for(const s of sentences){
      if((cur+" "+s).trim().length>max && cur){out.push(cur.trim());cur=s}
      else cur+=(cur?" ":"")+s;
    }
    if(cur)out.push(cur.trim());
  }
  return out;
}

async function translateLong(text,translator){
  const chunks=splitText(text,900);
  const out=[];
  for(const c of chunks){
    if(state.stop)break;
    state.chunks++;$("chunks").textContent=state.chunks;
    const r=await translator(c,{max_new_tokens:700});
    out.push(r?.[0]?.translation_text ?? "");
  }
  return out.join("\\n\\n");
}

function renderResults(){
  const wrap=$("pages");wrap.innerHTML="";
  for(const p of state.pages){
    const el=document.createElement("div");el.className="page";
    el.innerHTML=`<div class="pageTitle">Page ${p.page}</div><textarea aria-label="Translation page ${p.page}"></textarea>`;
    el.querySelector("textarea").value=p.translated;
    wrap.appendChild(el);
  }
  $("resultCard").classList.remove("hidden");
}

function downloadTxt(){
  const text=state.pages.map(p=>`===== Page ${p.page} =====\\n${p.translated}`).join("\\n\\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type:"text/plain;charset=utf-8"}));
  a.download=(state.file?.name||"translation").replace(/\\.[^.]+$/,"")+"_translated.txt";a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

window.addEventListener("error", e=>{
  const d=document.getElementById("detail");
  if(d) d.innerHTML='<div class="error">Page error: '+escapeHtml(e.message||"Unknown error")+'</div>';
});
window.addEventListener("unhandledrejection", e=>{
  const d=document.getElementById("detail");
  if(d) d.innerHTML='<div class="error">Loading error: '+escapeHtml(e.reason?.message||String(e.reason||"Unknown error"))+'</div>';
});
