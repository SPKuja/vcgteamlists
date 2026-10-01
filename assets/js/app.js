(function(){
  "use strict";

  var API="https://pokeapi.co/api/v2";
  var STORAGE_KEY="vcg-teamlists-v1";
  var LIST_CACHE_KEY="vcg-pokemon-list-v1";
  var statKeys=["hp","attack","defense","specialAttack","specialDefense","speed"];
  var statLabels={hp:"HP",attack:"Atk",defense:"Def",specialAttack:"SpA",specialDefense:"SpD",speed:"Spe"};
  var gameConfig={
    champions:{name:"Pokémon Champions",subtitle:"Stat Alignment, Stat Points and final battle stats.",art:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/6.png",alignmentLabel:"Stat Alignment",statPoints:true,tera:false,gmax:false},
    sv:{name:"Scarlet / Violet",subtitle:"Tera Type, nature/alignment, level and final stats.",art:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/1008.png",alignmentLabel:"Nature / Alignment",statPoints:false,tera:true,gmax:false},
    swsh:{name:"Sword / Shield",subtitle:"Nature, level, final stats and Gigantamax capability.",art:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/888.png",alignmentLabel:"Nature",statPoints:false,tera:false,gmax:true},
    custom:{name:"Custom / Other",subtitle:"A flexible team sheet for custom or legacy formats.",art:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",alignmentLabel:"Nature / Alignment",statPoints:false,tera:false,gmax:false}
  };

  var state={
    game:"champions",sheetMode:"full",editingIndex:null,
    meta:{playerName:"",trainerName:"",eventName:"",teamName:""},
    team:[null,null,null,null,null,null]
  };
  var pokemonList=[];
  var toastTimer=null;

  function $(s,root){return (root||document).querySelector(s)}
  function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}
  function prettyName(slug){
    return (slug||"").split("-").map(function(part){return part ? part.charAt(0).toUpperCase()+part.slice(1) : ""}).join(" ");
  }
  function escapeHtml(value){
    return String(value==null?"":value).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]});
  }
  function emptyStats(){return {hp:"",attack:"",defense:"",specialAttack:"",specialDefense:"",speed:""}}
  function blankMon(){
    return {slug:"",name:"",image:"",types:[],ability:"",item:"",gender:"",level:50,alignment:"",teraType:"",gigantamax:false,stats:emptyStats(),statPoints:emptyStats(),moves:["","","",""]};
  }
  function showToast(message){
    var el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(function(){el.classList.remove("show")},2200);
  }
  function saveState(silent){
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    if(!silent)showToast("Saved on this device");
  }
  function loadState(){
    try{
      var raw=localStorage.getItem(STORAGE_KEY);
      if(!raw)return;
      var saved=JSON.parse(raw);
      if(saved&&saved.team&&Array.isArray(saved.team)){
        state.game=saved.game||"champions";
        state.sheetMode=saved.sheetMode||"full";
        state.meta=Object.assign(state.meta,saved.meta||{});
        state.team=saved.team.slice(0,6);
        while(state.team.length<6)state.team.push(null);
      }
    }catch(err){console.warn("Could not restore team",err)}
  }

  function selectGame(game){
    if(!gameConfig[game])return;
    state.game=game;
    document.body.dataset.game=game;
    $("#builderTitle").textContent=gameConfig[game].name;
    $("#builderSubtitle").textContent=gameConfig[game].subtitle;
    $("#builderGameArt").style.backgroundImage="url('"+gameConfig[game].art+"')";
    saveState(true);renderTeam();navigate("team");
  }

  function navigate(target){
    if(target==="team"&&!state.game)target="home";
    $$(".view").forEach(function(v){v.classList.remove("is-active")});
    var id=target==="home"?"homeView":target==="preview"?"previewView":"builderView";
    $("#"+id).classList.add("is-active");
    $$(".bottom-nav button").forEach(function(b){b.classList.toggle("is-active",b.dataset.nav===target)});
    if(target==="preview")renderPreview();
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function renderTeam(){
    var grid=$("#teamGrid");grid.innerHTML="";
    var complete=0;
    state.team.forEach(function(mon,index){
      var button=document.createElement("button");
      button.className="team-slot"+(mon&&mon.name?"":" empty");
      button.dataset.slot=index;
      if(!mon||!mon.name){
        button.innerHTML='<span class="slot-number">SLOT '+(index+1)+'</span><span class="add-orb">+</span><strong>Add Pokémon</strong><small>Tap to fill this slot</small>';
      }else{
        complete++;
        var types=(mon.types||[]).map(function(t){return '<span class="type-pill">'+escapeHtml(t)+'</span>'}).join("");
        button.innerHTML='<span class="slot-number">SLOT '+(index+1)+'</span><div class="slot-img">'+(mon.image?'<img src="'+escapeHtml(mon.image)+'" alt="">':'')+'</div><div class="slot-name">'+escapeHtml(mon.name)+'</div><div class="slot-meta">'+escapeHtml(mon.ability||"No ability")+' · '+escapeHtml(mon.item||"No item")+'</div><div class="slot-types">'+types+'</div>';
      }
      grid.appendChild(button);
    });
    $("#completionCount").textContent=complete+" / 6 complete";
  }

  function renderStatInputs(){
    var final=$("#finalStats"),points=$("#statPoints");final.innerHTML="";points.innerHTML="";
    statKeys.forEach(function(key){
      final.insertAdjacentHTML("beforeend",'<label><span>'+statLabels[key]+'</span><input type="number" inputmode="numeric" min="0" data-final-stat="'+key+'" placeholder="—"></label>');
      points.insertAdjacentHTML("beforeend",'<label><span>'+statLabels[key]+'</span><input type="number" inputmode="numeric" min="0" data-point-stat="'+key+'" placeholder="0"></label>');
    });
  }

  function renderGameFields(mon){
    var config=gameConfig[state.game],wrap=$("#gameSpecificFields");
    var html='<div class="form-grid two" style="margin-top:10px"><label><span>'+escapeHtml(config.alignmentLabel)+'</span><input id="alignmentInput" placeholder="e.g. Timid"></label>';
    if(config.tera)html+='<label><span>Tera Type</span><input id="teraInput" placeholder="e.g. Grass"></label>';
    html+='</div>';
    if(config.gmax)html+='<label class="inline-toggle"><div><strong>Gigantamax capable</strong><small>Mark this specimen as Gigantamax-capable.</small></div><input id="gmaxInput" type="checkbox"></label>';
    wrap.innerHTML=html;
    $("#statPointsSection").style.display=config.statPoints?"block":"none";
    $("#movesNumber").textContent=config.statPoints?"04":"03";
    $("#alignmentInput").value=mon.alignment||"";
    if($("#teraInput"))$("#teraInput").value=mon.teraType||"";
    if($("#gmaxInput"))$("#gmaxInput").checked=!!mon.gigantamax;
  }

  function openEditor(index){
    state.editingIndex=index;
    var mon=state.team[index]?JSON.parse(JSON.stringify(state.team[index])):blankMon();
    $("#slotLabel").textContent="Team slot "+(index+1);
    $("#editorTitle").textContent=mon.name?"Edit Pokémon":"Add Pokémon";
    $("#pokemonSearch").value="";
    $("#abilityInput").value=mon.ability||"";
    $("#itemInput").value=mon.item||"";
    $("#genderInput").value=mon.gender||"";
    $("#levelInput").value=mon.level||50;
    $$(".move-input").forEach(function(input){input.value=(mon.moves||[])[Number(input.dataset.move)]||""});
    renderGameFields(mon);
    statKeys.forEach(function(key){
      $('[data-final-stat="'+key+'"]').value=(mon.stats&&mon.stats[key])||"";
      $('[data-point-stat="'+key+'"]').value=(mon.statPoints&&mon.statPoints[key])||"";
    });
    setEditorPokemon(mon);
    $("#removePokemonButton").style.visibility=mon.name?"visible":"hidden";
    $("#editorBackdrop").hidden=false;
    document.body.style.overflow="hidden";
    setTimeout(function(){$("#pokemonSearch").focus()},180);
  }

  function closeEditor(){
    $("#editorBackdrop").hidden=true;$("#pokemonResults").hidden=true;document.body.style.overflow="";
  }

  function setEditorPokemon(mon){
    var name=$("#editorPokemonName"),img=$("#editorPokemonImage"),empty=$(".empty-ball"),types=$("#typeRow");
    name.textContent=mon.name||"Choose a Pokémon";
    if(mon.image){img.src=mon.image;img.hidden=false;empty.style.display="none"}else{img.hidden=true;empty.style.display=""}
    types.innerHTML=(mon.types||[]).map(function(t){return '<span class="type-pill">'+escapeHtml(t)+'</span>'}).join("");
    $("#selectedPokemon").dataset.slug=mon.slug||"";
    $("#selectedPokemon").dataset.name=mon.name||"";
    $("#selectedPokemon").dataset.image=mon.image||"";
    $("#selectedPokemon").dataset.types=JSON.stringify(mon.types||[]);
  }

  async function ensurePokemonList(){
    if(pokemonList.length)return pokemonList;
    try{
      var cached=localStorage.getItem(LIST_CACHE_KEY);
      if(cached){pokemonList=JSON.parse(cached);if(pokemonList.length)return pokemonList}
    }catch(e){}
    var res=await fetch(API+"/pokemon?limit=2500");
    if(!res.ok)throw new Error("PokéAPI list request failed");
    var data=await res.json();
    pokemonList=data.results.map(function(p){return p.name});
    try{localStorage.setItem(LIST_CACHE_KEY,JSON.stringify(pokemonList))}catch(e){}
    return pokemonList;
  }

  async function searchPokemon(query){
    var results=$("#pokemonResults");
    if(query.trim().length<2){results.hidden=true;return}
    results.hidden=false;results.innerHTML='<button class="search-result" disabled>Searching…</button>';
    try{
      await ensurePokemonList();
      var q=query.toLowerCase().trim();
      var matches=pokemonList.filter(function(name){return name.indexOf(q)!==-1}).sort(function(a,b){
        var as=a.indexOf(q),bs=b.indexOf(q);return as-bs||a.length-b.length;
      }).slice(0,12);
      if(!matches.length){results.innerHTML='<button class="search-result" disabled>No matches — keep typing or try another spelling.</button>';return}
      results.innerHTML=matches.map(function(slug){return '<button class="search-result" data-pokemon="'+escapeHtml(slug)+'">'+escapeHtml(prettyName(slug))+'<small>'+escapeHtml(slug)+'</small></button>'}).join("");
    }catch(err){
      results.innerHTML='<button class="search-result" disabled>Could not reach PokéAPI. You can try again in a moment.</button>';
    }
  }

  async function choosePokemon(slug){
    $("#pokemonResults").hidden=true;$("#pokemonSearch").value=prettyName(slug);
    $("#editorPokemonName").textContent="Loading "+prettyName(slug)+"…";
    try{
      var res=await fetch(API+"/pokemon/"+encodeURIComponent(slug));
      if(!res.ok)throw new Error("Pokémon request failed");
      var data=await res.json();
      var image=(data.sprites&&data.sprites.other&&data.sprites.other.home&&data.sprites.other.home.front_default)||
        (data.sprites&&data.sprites.other&&data.sprites.other["official-artwork"]&&data.sprites.other["official-artwork"].front_default)||
        (data.sprites&&data.sprites.front_default)||"";
      var mon={slug:slug,name:prettyName(slug),image:image,types:(data.types||[]).map(function(t){return prettyName(t.type.name)})};
      setEditorPokemon(mon);
      if(!$("#abilityInput").value&&data.abilities&&data.abilities[0])$("#abilityInput").value=prettyName(data.abilities[0].ability.name);
    }catch(err){
      $("#editorPokemonName").textContent=prettyName(slug);
      showToast("Could not load artwork — you can still enter the team manually");
    }
  }

  function collectEditor(){
    var selected=$("#selectedPokemon");
    var existing=state.team[state.editingIndex]||blankMon();
    var mon=blankMon();
    mon.slug=selected.dataset.slug||existing.slug||"";
    mon.name=selected.dataset.name||existing.name||$("#pokemonSearch").value.trim();
    mon.image=selected.dataset.image||existing.image||"";
    try{mon.types=JSON.parse(selected.dataset.types||"[]")}catch(e){mon.types=[]}
    mon.ability=$("#abilityInput").value.trim();
    mon.item=$("#itemInput").value.trim();
    mon.gender=$("#genderInput").value;
    mon.level=Number($("#levelInput").value)||50;
    mon.alignment=$("#alignmentInput")?$("#alignmentInput").value.trim():"";
    mon.teraType=$("#teraInput")?$("#teraInput").value.trim():"";
    mon.gigantamax=$("#gmaxInput")?$("#gmaxInput").checked:false;
    statKeys.forEach(function(key){
      mon.stats[key]=$('[data-final-stat="'+key+'"]').value.trim();
      mon.statPoints[key]=$('[data-point-stat="'+key+'"]').value.trim();
    });
    mon.moves=$$(".move-input").map(function(input){return input.value.trim()});
    return mon;
  }

  function saveEditor(){
    var mon=collectEditor();
    if(!mon.name){showToast("Choose or enter a Pokémon first");return}
    state.team[state.editingIndex]=mon;saveState(true);renderTeam();closeEditor();showToast(mon.name+" saved");
  }

  function removeEditor(){
    if(state.editingIndex==null)return;
    state.team[state.editingIndex]=null;saveState(true);renderTeam();closeEditor();showToast("Pokémon removed");
  }

  function syncMeta(){
    ["playerName","trainerName","eventName","teamName"].forEach(function(key){state.meta[key]=$("#"+key).value.trim()});
    saveState(true);
  }
  function populateMeta(){
    ["playerName","trainerName","eventName","teamName"].forEach(function(key){$("#"+key).value=state.meta[key]||""});
  }

  function monExtra(mon,mode){
    var bits=[];
    if(mon.alignment)bits.push(gameConfig[state.game].alignmentLabel+": "+mon.alignment);
    if(state.game==="sv"&&mon.teraType)bits.push("Tera: "+mon.teraType);
    if(state.game==="swsh"&&mon.gigantamax)bits.push("Gigantamax: Yes");
    if(mon.gender)bits.push(mon.gender);
    bits.push("Lv. "+(mon.level||50));
    return bits;
  }
  function statHtml(mon,includePoints){
    return statKeys.map(function(key){
      var value=(mon.stats&&mon.stats[key])||"—";
      if(includePoints&&state.game==="champions"){
        var points=(mon.statPoints&&mon.statPoints[key]);
        if(points!==""&&points!=null)value=value+" / "+points+" SP";
      }
      return '<div class="paper-stat"><small>'+statLabels[key]+'</small><strong>'+escapeHtml(value)+'</strong></div>';
    }).join("");
  }
  function printStatHtml(mon,includePoints){
    return statKeys.map(function(key){
      var value=(mon.stats&&mon.stats[key])||"—";
      if(includePoints&&state.game==="champions"){
        var points=(mon.statPoints&&mon.statPoints[key]);
        if(points!==""&&points!=null)value=value+" / "+points+" SP";
      }
      return '<div class="print-stat"><small>'+statLabels[key]+'</small><strong>'+escapeHtml(value)+'</strong></div>';
    }).join("");
  }

  function renderPreview(){
    syncMeta();
    var mode=state.sheetMode;
    $("[data-sheet-mode='full']").classList.toggle("is-selected",mode==="full");
    $("[data-sheet-mode='open']").classList.toggle("is-selected",mode==="open");
    var completed=state.team.filter(function(m){return m&&m.name});
    var teamHtml=completed.map(function(mon){
      var extras=monExtra(mon,mode).map(function(x){return "<span>"+escapeHtml(x)+"</span>"}).join("");
      var moves=(mon.moves||[]).filter(Boolean).map(function(m){return "<div>"+escapeHtml(m)+"</div>"}).join("");
      return '<article class="paper-mon"><div class="paper-mon-art">'+(mon.image?'<img src="'+escapeHtml(mon.image)+'" alt="">':'')+'</div><div class="paper-mon-body"><div class="paper-mon-top"><div><div class="paper-mon-name">'+escapeHtml(mon.name)+'</div><div class="paper-mon-sub">'+escapeHtml(mon.ability||"No ability")+' · '+escapeHtml(mon.item||"No item")+'</div></div></div><div class="paper-moves">'+moves+'</div><div class="paper-extra">'+extras+'</div>'+(mode==="full"?'<div class="paper-stats">'+statHtml(mon,true)+'</div>':'')+'</div></article>';
    }).join("");
    if(!teamHtml)teamHtml='<p style="color:#777;font-size:12px">Add Pokémon to your team to see the generated sheet.</p>';
    $("#screenPreview").innerHTML='<header class="paper-header"><div class="paper-brand"><h2>VGC Team List</h2><p>'+escapeHtml(gameConfig[state.game].name)+' · '+(mode==="full"?"Full / registration":"Open team sheet")+'</p></div><div class="paper-meta"><strong>'+escapeHtml(state.meta.playerName||"Player")+'</strong>'+escapeHtml(state.meta.trainerName||"Trainer name")+'<br>'+escapeHtml(state.meta.eventName||"Event")+'</div></header><div class="paper-team">'+teamHtml+'</div>';
    renderPrint();
  }

  function renderPrint(){
    var mode=state.sheetMode;
    var completed=state.team.filter(function(m){return m&&m.name});
    var mons=completed.map(function(mon){
      var moves=(mon.moves||[]).map(function(m){return '<div class="print-move">'+escapeHtml(m||"—")+'</div>'}).join("");
      var extras=monExtra(mon,mode).join(" · ");
      return '<article class="print-mon"><div class="print-mon-head"><div class="print-mon-art">'+(mon.image?'<img src="'+escapeHtml(mon.image)+'" alt="">':'')+'</div><div class="print-mon-title"><h2>'+escapeHtml(mon.name)+'</h2><p>'+escapeHtml(extras)+'</p></div></div><div class="print-mon-body"><div class="print-row"><b>Ability</b><span>'+escapeHtml(mon.ability||"—")+'</span></div><div class="print-row"><b>Held Item</b><span>'+escapeHtml(mon.item||"—")+'</span></div><div class="print-moves">'+moves+'</div>'+(mode==="full"?'<div class="print-stats">'+printStatHtml(mon,true)+'</div>':'')+'</div></article>';
    }).join("");
    $("#printRoot").innerHTML='<section class="print-sheet"><header class="print-head"><div><h1>VGC Team List</h1><p>'+escapeHtml(gameConfig[state.game].name)+' · '+(mode==="full"?"Full / registration copy":"Open team sheet")+'</p></div><div class="print-meta"><strong>'+escapeHtml(state.meta.playerName||"Player")+'</strong>Trainer: '+escapeHtml(state.meta.trainerName||"—")+'<br>Event: '+escapeHtml(state.meta.eventName||"—")+(state.meta.teamName?'<br>Team: '+escapeHtml(state.meta.teamName):'')+'</div></header><div class="print-team">'+mons+'</div><div class="print-foot">Generated with VGC Team Lists · Verify all information against the game before tournament submission.</div></section>';
  }

  function shareTeam(){
    var completed=state.team.filter(function(m){return m&&m.name});
    if(!completed.length){showToast("Add at least one Pokémon before sharing");return}
    var lines=[state.meta.teamName||"VGC Team",gameConfig[state.game].name,""];
    completed.forEach(function(mon){
      lines.push(mon.name+" @ "+(mon.item||"No item"));
      lines.push("Ability: "+(mon.ability||"—"));
      if(mon.moves)mon.moves.filter(Boolean).forEach(function(m){lines.push("- "+m)});
      lines.push("");
    });
    var text=lines.join("\n");
    if(navigator.share){
      navigator.share({title:state.meta.teamName||"VGC Team List",text:text,url:location.href}).catch(function(){});
    }else if(navigator.clipboard){
      navigator.clipboard.writeText(text).then(function(){showToast("Team copied to clipboard")});
    }else{showToast("Sharing is not available in this browser")}
  }

  function clearTeam(){
    if(!confirm("Clear all six Pokémon from this team?"))return;
    state.team=[null,null,null,null,null,null];saveState(true);renderTeam();showToast("Team cleared");
  }

  function wireEvents(){
    $$("[data-select-game]").forEach(function(b){b.addEventListener("click",function(){selectGame(b.dataset.selectGame)})});
    $$("[data-nav]").forEach(function(b){b.addEventListener("click",function(){navigate(b.dataset.nav)})});
    $("#teamGrid").addEventListener("click",function(e){var slot=e.target.closest(".team-slot");if(slot)openEditor(Number(slot.dataset.slot))});
    $("#closeEditorButton").addEventListener("click",closeEditor);
    $("#editorBackdrop").addEventListener("click",function(e){if(e.target===$("#editorBackdrop"))closeEditor()});
    $("#savePokemonButton").addEventListener("click",saveEditor);
    $("#removePokemonButton").addEventListener("click",removeEditor);
    $("#pokemonSearch").addEventListener("input",function(e){searchPokemon(e.target.value)});
    $("#pokemonResults").addEventListener("click",function(e){var hit=e.target.closest("[data-pokemon]");if(hit)choosePokemon(hit.dataset.pokemon)});
    $("#saveLocalButton").addEventListener("click",function(){syncMeta();saveState(false)});
    $("#clearTeamButton").addEventListener("click",clearTeam);
    ["playerName","trainerName","eventName","teamName"].forEach(function(id){$("#"+id).addEventListener("change",syncMeta)});
    $$("[data-sheet-mode]").forEach(function(b){b.addEventListener("click",function(){state.sheetMode=b.dataset.sheetMode;saveState(true);renderPreview()})});
    $("#printButton").addEventListener("click",function(){renderPrint();window.print()});
    $("#shareButton").addEventListener("click",shareTeam);
    document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!$("#editorBackdrop").hidden)closeEditor()});
  }

  function init(){
    loadState();renderStatInputs();populateMeta();wireEvents();selectGame(state.game||"champions");renderTeam();
    navigate("home");
    if("serviceWorker" in navigator)window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})});
  }

  document.addEventListener("DOMContentLoaded",init);
})();