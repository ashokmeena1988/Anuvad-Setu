let createWorker, pdfjsLib, pipeline, env;
const $=id=>document.getElementById(id);
const state={file:null,stop:false,pages:[],chunks:0};

async function loadLibraries(){
  $("status").textContent="Loading browser components…";
  $("detail").textContent="Loading PDF, OCR and translation engines…";
  const [t,p,h]=await Promise.all([
    import("https://cdn.jsdelivr.net/npm/tesseract.js@7/+esm"),
    import("https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.mjs"),
    import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/+esm")
  ]);
  createWorker=t.createWorker;
  pdfjsLib=p;
  pipeline=h.pipeline;
  env=h.env;
  pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.worker.mjs";
  env.allowLocalModels=false;
  env.useBrowserCache=true;
}

export async function runTranslator(file){
  if(!file) throw new Error("Please choose a PDF, JPG or JPEG file first.");
  state.file=file; state.stop=false; state.pages=[]; state.chunks=0;
  $("chunks").textContent="0"; $("donePages").textContent="0";
  $("resultCard").classList.add("hidden");
  $("progressCard").classList.remove("hidden");

  await loadLibraries();

  const direction=$("direction").value;
  $("status").textContent="Loading translation engine…";
  $("detail").textContent="First run downloads the free translation model and caches it in your browser.";
  $("bar").style.width="5%"; $("percent").textContent="5%";

  const model=direction==="en-hi"?"Xenova/opus-mt-en-hi":"Xenova/opus-mt-hi-en";
  const translator=await pipeline("translation",model,{dtype:"q8"});

  $("status").textContent="Translation engine ready";
  if(/\.pdf$/i.test(file.name)) await processPDF(file,translator);
  else await processImage(file,translator);

  renderResults();
  $("status").textContent="Completed";
  $("detail").textContent=`Translated ${state.pages.length} page(s).`;
  $("bar").style.width="100%"; $("percent").textContent="100%";
  $("startBtn").disabled=false;
}

async function processPDF(file,translator){
  const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  $("totalPages").textContent=pdf.numPages;
  const scale=parseFloat($("ocrScale").value);
  const mode=$("mode").value;
  const lang=$("direction").value==="en-hi"?"eng":"hin";
  const worker=await createWorker(lang,1);
  try{
    for(let i=1;i<=pdf.numPages;i++){
      $("status").textContent=`Processing page ${i} of ${pdf.numPages}`;
      $("detail").textContent="Extracting text…";
      let text="";
      const page=await pdf.getPage(i);
      if(mode!=="ocr"){
        const content=await page.getTextContent();
        text=content.items.map(x=>x.str).join(" ").replace(/\s+/g," ").trim();
      }
      if(mode==="ocr" || text.length<40){
        $("detail").textContent="Scanned/low-text page — OCR in progress…";
        const viewport=page.getViewport({scale});
        const canvas=document.createElement("canvas");
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
        const r=await worker.recognize(canvas);
        text=r.data.text||"";
      }
      $("detail").textContent="Translating page…";
      const translated=await translateLong(text,translator);
      state.pages.push({page:i,original:text,translated});
      $("donePages").textContent=state.pages.length;
      const pct=Math.round(i/pdf.numPages*100);
      $("bar").style.width=pct+"%";$("percent").textContent=pct+"%";
    }
  }finally{await worker.terminate()}
}

async function processImage(file,translator){
  $("totalPages").textContent="1";
  $("status").textContent="OCR image";
  const worker=await createWorker($("direction").value==="en-hi"?"eng":"hin",1);
  try{
    const r=await worker.recognize(file);
    $("detail").textContent="Translating image text…";
    const translated=await translateLong(r.data.text||"",translator);
    state.pages.push({page:1,original:r.data.text||"",translated});
    $("donePages").textContent="1";
  }finally{await worker.terminate()}
}

function splitText(text,max=900){
  text=(text||"").replace(/\r/g,"").trim();
  if(!text)return[];
  const paras=text.split(/\n{2,}/).map(x=>x.trim()).filter(Boolean);
  const out=[];
  for(const p of paras){
    if(p.length<=max){out.push(p);continue}
    let cur="";
    for(const s of p.split(/(?<=[.!?।॥])\s+/)){
      if((cur+" "+s).trim().length>max&&cur){out.push(cur.trim());cur=s}
      else cur+=(cur?" ":"")+s;
    }
    if(cur)out.push(cur.trim());
  }
  return out;
}

async function translateLong(text,translator){
  const chunks=splitText(text);
  const out=[];
  for(const c of chunks){
    state.chunks++;$("chunks").textContent=state.chunks;
    const r=await translator(c,{max_new_tokens:700});
    out.push(r?.[0]?.translation_text||"");
  }
  return out.join("\n\n");
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

window.addEventListener("unhandledrejection",e=>{
  const d=$("detail"); if(d) d.innerHTML=`<div class="error">${String(e.reason?.message||e.reason)}</div>`;
});
