(function(){
  "use strict";

  var API="https://pokeapi.co/api/v2";
  var STORAGE_KEY="vcg-teamlists-v2";
  var LEGACY_STORAGE_KEY="vcg-teamlists-v1";
  var LOCAL_SAVE_KEY="vcg-saved-build-v1";
  var LIST_CACHE_KEY="vcg-pokemon-species-list-v2";
  var MOVE_META_CACHE_KEY="vcg-move-meta-v1";
  var statKeys=["hp","attack","defense","specialAttack","specialDefense","speed"];
  var statLabels={hp:"HP",attack:"Atk",defense:"Def",specialAttack:"SpA",specialDefense:"SpD",speed:"Spe"};
  var gameConfig={
    champions:{name:"Pokémon Champions",subtitle:"Stat Alignment, Stat Points and final battle stats.",art:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/6.png",alignmentLabel:"Stat Alignment",statPoints:true,tera:false,gmax:false},
    sv:{name:"Scarlet / Violet",subtitle:"Tera Type, nature/alignment, level and final stats.",art:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/1008.png",alignmentLabel:"Nature / Alignment",statPoints:false,tera:true,gmax:false},
    swsh:{name:"Sword / Shield",subtitle:"Nature, level, final stats and Gigantamax capability.",art:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/888.png",alignmentLabel:"Nature",statPoints:false,tera:false,gmax:true},
    custom:{name:"Custom / Other",subtitle:"A flexible team sheet for custom or legacy formats.",art:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",alignmentLabel:"Nature / Alignment",statPoints:false,tera:false,gmax:false}
  };

  var state={
    game:null,sheetMode:"full",editingIndex:null,activeBuild:false,dirty:false,
    meta:{playerName:"",trainerName:"",playerId:"",yearOfBirth:""},
    team:[null,null,null,null,null,null]
  };
  var pokemonList=[];
  var resourceLists={ability:null,item:null,nature:null,move:null};
  var moveMetaCache=null;
  var toastTimer=null;

  function $(s,root){return (root||document).querySelector(s)}
  function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}
  function prettyName(slug){
    return (slug||"").split("-").map(function(part){return part ? part.charAt(0).toUpperCase()+part.slice(1) : ""}).join(" ");
  }
  function formLabel(speciesSlug,varietySlug,isDefault){
    if(isDefault||!varietySlug||varietySlug===speciesSlug)return "Standard";
    var suffix=varietySlug.indexOf(speciesSlug+"-")===0?varietySlug.slice(speciesSlug.length+1):varietySlug;
    var regions={alola:"Alolan",galar:"Galarian",hisui:"Hisuian",paldea:"Paldean"};
    var bits=suffix.split("-");
    if(regions[bits[0]]){
      if(bits.length===1)return regions[bits[0]]+" Form";
      return regions[bits[0]]+" "+prettyName(bits.slice(1).join("-"));
    }
    if(suffix==="gmax")return "Gigantamax";
    if(suffix==="mega")return "Mega";
    if(suffix.indexOf("mega-")===0)return "Mega "+prettyName(suffix.slice(5));
    if(["heat","wash","frost","fan","mow"].indexOf(suffix)!==-1)return prettyName(suffix)+" Form";
    return prettyName(suffix);
  }
  function displayMonName(mon){
    return mon&&mon.form&&mon.form!=="Standard"?mon.name+" — "+mon.form:(mon&&mon.name)||"";
  }
  function escapeHtml(value){
    return String(value==null?"":value).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]});
  }
  function emptyStats(){return {hp:"",attack:"",defense:"",specialAttack:"",specialDefense:"",speed:""}}
  function blankMon(){
    return {speciesSlug:"",slug:"",name:"",form:"",availableForms:[],image:"",types:[],availableAbilities:[],availableMoves:[],ability:"",item:"",gender:"",level:50,alignment:"",teraType:"",gigantamax:false,stats:emptyStats(),statPoints:emptyStats(),moves:["","","",""],moveTypes:["","","",""],moveClasses:["","","",""]};
  }
  function showToast(message){
    var el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(function(){el.classList.remove("show")},2200);
  }
  function saveState(silent){
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    if(!silent)showToast("Draft saved on this device");
  }

  function loadState(){
    try{
      var raw=localStorage.getItem(STORAGE_KEY);
      if(!raw){
        var legacy=localStorage.getItem(LEGACY_STORAGE_KEY);
        if(legacy){
          var old=JSON.parse(legacy);
          if(old&&old.meta)state.meta=Object.assign(state.meta,old.meta);
        }
        return;
      }
      var saved=JSON.parse(raw);
      if(saved&&saved.meta)state.meta=Object.assign(state.meta,saved.meta||{});
      if(saved&&saved.activeBuild===true&&saved.game&&gameConfig[saved.game]&&Array.isArray(saved.team)){
        state.game=saved.game;
        state.sheetMode=saved.sheetMode||"full";
        state.activeBuild=true;
        state.dirty=!!saved.dirty;
        state.team=saved.team.slice(0,6);
        while(state.team.length<6)state.team.push(null);
      }
    }catch(err){console.warn("Could not restore team",err)}
  }

  function blankTeam(){return [null,null,null,null,null,null]}

  function markDirty(){
    if(!state.activeBuild)return;
    state.dirty=true;
    saveState(true);
    document.dispatchEvent(new CustomEvent("vcg:builddirty"));
  }

  function markSaved(){
    if(!state.activeBuild)return;
    state.dirty=false;
    saveState(true);
    document.dispatchEvent(new CustomEvent("vcg:buildsaved"));
  }

  function localSavedBuild(){
    try{
      var raw=localStorage.getItem(LOCAL_SAVE_KEY);
      if(!raw)return null;
      var saved=JSON.parse(raw);
      return saved&&saved.game&&Array.isArray(saved.team)?saved:null;
    }catch(e){return null}
  }

  function saveLocalBuild(){
    if(!state.activeBuild){showToast("Choose a game first");return}
    syncMeta(false);
    var payload={
      game:state.game,
      sheetMode:state.sheetMode,
      meta:JSON.parse(JSON.stringify(state.meta)),
      team:JSON.parse(JSON.stringify(state.team))
    };
    localStorage.setItem(LOCAL_SAVE_KEY,JSON.stringify(payload));
    markSaved();
    showToast("Team saved on this device");
  }

  function resetBuild(){
    state.game=null;
    state.sheetMode="full";
    state.editingIndex=null;
    state.activeBuild=false;
    state.dirty=false;
    state.team=blankTeam();
    saveState(true);
    renderTeam();
    document.dispatchEvent(new CustomEvent("vcg:buildreset"));
  }

  function confirmDiscard(){
    if(!state.activeBuild)return true;
    if(state.dirty){
      return confirm("This team has unsaved changes. Leave the builder and clear them?");
    }
    return true;
  }

  function leaveBuild(){
    if(!state.activeBuild)return true;
    if(!confirmDiscard())return false;
    resetBuild();
    return true;
  }

  function startNewBuild(game){
    state.game=game;
    state.sheetMode="full";
    state.editingIndex=null;
    state.activeBuild=true;
    state.dirty=false;
    state.team=blankTeam();
    document.body.dataset.game=game;
    $("#builderTitle").textContent=gameConfig[game].name;
    $("#builderGameArt").style.backgroundImage="url('"+gameConfig[game].art+"')";
    populateMeta();
    saveState(true);
    renderTeam();
  }

  function selectGame(game){
    if(!gameConfig[game])return;
    if(state.activeBuild&&!leaveBuild())return;

    var saved=localSavedBuild();
    if(saved&&saved.game===game){
      var resume=confirm("You have a saved "+gameConfig[game].name+" team on this device. Resume it?\n\nChoose Cancel to start a new team.");
      if(resume){
        state.game=game;
        state.sheetMode=saved.sheetMode==="open"?"open":"full";
        state.activeBuild=true;
        state.dirty=false;
        state.meta=Object.assign(state.meta,saved.meta||{});
        state.team=saved.team.slice(0,6);
        while(state.team.length<6)state.team.push(null);
        document.body.dataset.game=game;
        $("#builderTitle").textContent=gameConfig[game].name;
        $("#builderGameArt").style.backgroundImage="url('"+gameConfig[game].art+"')";
        populateMeta();renderTeam();saveState(true);navigate("team");
        return;
      }
    }

    startNewBuild(game);
    navigate("team");
  }

  var routePaths={home:"/",team:"/team-builder",teams:"/my-teams",preview:"/preview",profile:"/profile"};

  function routeTarget(pathname){
    var path=(pathname||"/").replace(/\/+$/,"")||"/";
    if(path==="/team-builder")return "team";
    if(path==="/my-teams")return "teams";
    if(path==="/preview")return "preview";
    if(path==="/profile")return "profile";
    return "home";
  }

  function navigate(target,options){
    options=options||{};
    var current=$(".view.is-active");
    var currentTarget=current&&current.id==="builderView"?"team":current&&current.id==="previewView"?"preview":current&&current.id==="teamsView"?"teams":current&&current.id==="profileView"?"profile":"home";
    var leavingBuild=(currentTarget==="team"||currentTarget==="preview")&&(target!=="team"&&target!=="preview");

    if(leavingBuild&&!options.skipBuildGuard){
      if(!leaveBuild())return false;
    }

    if((target==="team"||target==="preview")&&!state.activeBuild){
      target="home";
      if(!options.silent)showToast("Choose a game before opening the team builder");
    }

    $$(".view").forEach(function(v){v.classList.remove("is-active")});
    var id=target==="home"?"homeView":target==="preview"?"previewView":target==="teams"?"teamsView":target==="profile"?"profileView":"builderView";
    $("#"+id).classList.add("is-active");
    $$(".bottom-nav button").forEach(function(b){b.classList.toggle("is-active",b.dataset.nav===target)});
    if(target==="preview")renderPreview();

    if(!options.skipHistory){
      var next=routePaths[target]||"/";
      if(location.pathname!==next){
        if(options.replace)history.replaceState({target:target},"",next);
        else history.pushState({target:target},"",next);
      }
    }

    document.dispatchEvent(new CustomEvent("vcg:navigate",{detail:{target:target}}));
    if(!options.noScroll)window.scrollTo({top:0,behavior:options.instant?"auto":"smooth"});
    return true;
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
        button.innerHTML='<span class="slot-number">SLOT '+(index+1)+'</span><div class="slot-img">'+(mon.image?'<img src="'+escapeHtml(mon.image)+'" alt="">':'')+'</div><div class="slot-name">'+escapeHtml(displayMonName(mon))+'</div><div class="slot-meta">'+escapeHtml(mon.ability||"No ability")+' · '+escapeHtml(mon.item||"No item")+'</div><div class="slot-types">'+types+'</div>';
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
    var html='<div class="form-grid two" style="margin-top:10px"><div class="autocomplete-field" data-resource="nature"><label for="alignmentInput">'+escapeHtml(config.alignmentLabel)+'</label><div class="autocomplete-control"><input id="alignmentInput" autocomplete="off" placeholder="Search alignments"><button type="button" class="field-caret" data-open-suggestions="alignmentInput" aria-label="Show alignments">⌄</button></div><div class="field-results" data-results-for="alignmentInput" hidden></div></div>';
    if(config.tera)html+='<label><span>Tera Type</span><input id="teraInput" placeholder="e.g. Grass"></label>';
    html+='</div>';
    if(config.gmax)html+='<label class="inline-toggle"><div><strong>Gigantamax capable</strong></div><input id="gmaxInput" type="checkbox"></label>';
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
    if(mon.name)hydrateExistingPokemon(mon);
    $("#removePokemonButton").style.visibility=mon.name?"visible":"hidden";
    $("#editorBackdrop").hidden=false;
    document.body.style.overflow="hidden";
    Promise.all([
      ensureResourceList("ability"),
      ensureResourceList("item"),
      ensureResourceList("nature"),
      ensureResourceList("move")
    ]).catch(function(){});
    setTimeout(function(){$("#pokemonSearch").focus()},180);
  }

  function closeEditor(){
    $("#editorBackdrop").hidden=true;$("#pokemonResults").hidden=true;closeFieldResults();document.body.style.overflow="";
  }

  function renderFormSelector(mon){
    var field=$("#formField"),select=$("#formSelect");
    var forms=mon.availableForms||[];
    if(forms.length<=1){field.hidden=true;select.innerHTML="";return}
    field.hidden=false;
    select.innerHTML=forms.map(function(v){
      return '<option value="'+escapeHtml(v.slug)+'">'+escapeHtml(formLabel(mon.speciesSlug,v.slug,v.isDefault))+'</option>';
    }).join("");
    select.value=mon.slug||forms[0].slug;
  }

  function setEditorPokemon(mon){
    var name=$("#editorPokemonName"),img=$("#editorPokemonImage"),empty=$(".empty-ball"),types=$("#typeRow");
    name.textContent=mon.name||"Choose a Pokémon";
    if(mon.image){img.src=mon.image;img.hidden=false;empty.style.display="none"}else{img.hidden=true;empty.style.display=""}
    types.innerHTML=(mon.types||[]).map(function(t){return '<span class="type-pill">'+escapeHtml(t)+'</span>'}).join("");
    $("#selectedPokemon").dataset.speciesSlug=mon.speciesSlug||"";
    $("#selectedPokemon").dataset.slug=mon.slug||"";
    $("#selectedPokemon").dataset.name=mon.name||"";
    $("#selectedPokemon").dataset.form=mon.form||"";
    $("#selectedPokemon").dataset.forms=JSON.stringify(mon.availableForms||[]);
    $("#selectedPokemon").dataset.image=mon.image||"";
    $("#selectedPokemon").dataset.types=JSON.stringify(mon.types||[]);
    $("#selectedPokemon").dataset.abilities=JSON.stringify(mon.availableAbilities||[]);
    $("#selectedPokemon").dataset.moves=JSON.stringify(mon.availableMoves||[]);
    renderFormSelector(mon);
  }

  async function ensureResourceList(resource){
    if(resourceLists[resource]&&resourceLists[resource].length)return resourceLists[resource];
    var cacheKey="vcg-resource-"+resource+"-v1";
    try{
      var cached=localStorage.getItem(cacheKey);
      if(cached){
        resourceLists[resource]=JSON.parse(cached);
        if(resourceLists[resource].length)return resourceLists[resource];
      }
    }catch(e){}
    var limit=resource==="nature"?100:5000;
    var res=await fetch(API+"/"+resource+"?limit="+limit);
    if(!res.ok)throw new Error(resource+" list request failed");
    var data=await res.json();
    resourceLists[resource]=(data.results||[]).map(function(entry){return entry.name});
    try{localStorage.setItem(cacheKey,JSON.stringify(resourceLists[resource]))}catch(e){}
    return resourceLists[resource];
  }

  function closeFieldResults(exceptInputId){
    $$(".field-results").forEach(function(panel){
      if(panel.dataset.resultsFor!==exceptInputId)panel.hidden=true;
    });
  }

  function fieldPriority(resource){
    var raw="[]";
    if(resource==="ability")raw=$("#selectedPokemon").dataset.abilities||"[]";
    if(resource==="move")raw=$("#selectedPokemon").dataset.moves||"[]";
    try{return JSON.parse(raw)}catch(e){return []}
  }

  async function showFieldSuggestions(input,forceOpen){
    if(!input||!input.closest)return;
    var field=input.closest(".autocomplete-field");
    if(!field)return;
    var resource=field.dataset.resource;
    var panel=$('[data-results-for="'+input.id+'"]');
    if(!panel)return;
    var q=input.value.toLowerCase().trim().replace(/\s+/g,"-");
    if(!forceOpen&&q.length<1){panel.hidden=true;return}
    closeFieldResults(input.id);
    panel.hidden=false;
    panel.innerHTML='<div class="field-empty">Loading…</div>';
    try{
      var list=await ensureResourceList(resource);
      var priority=fieldPriority(resource);
      var ranked=list.filter(function(name){return !q||name.indexOf(q)!==-1}).sort(function(a,b){
        var ap=priority.indexOf(a),bp=priority.indexOf(b);
        if(ap!==-1||bp!==-1){
          if(ap===-1)return 1;
          if(bp===-1)return -1;
          return ap-bp;
        }
        if(q){
          var ai=a.indexOf(q),bi=b.indexOf(q);
          if(ai!==bi)return ai-bi;
        }
        return a.localeCompare(b);
      });
      if(!ranked.length){panel.innerHTML='<div class="field-empty">No matches</div>';return}
      var visible=q?ranked.slice(0,80):ranked;
      panel.innerHTML=visible.map(function(name){
        var preferred=priority.indexOf(name)!==-1;
        var tag=preferred?(resource==="ability"?"For this Pokémon":"Species move"):"";
        return '<button type="button" class="field-result" data-field-value="'+escapeHtml(prettyName(name))+'" data-target-input="'+escapeHtml(input.id)+'"><strong>'+escapeHtml(prettyName(name))+'</strong>'+(tag?'<small>'+tag+'</small>':'')+'</button>';
      }).join("");
    }catch(err){
      panel.innerHTML='<div class="field-empty">Suggestions unavailable</div>';
    }
  }

  async function ensurePokemonList(){
    if(pokemonList.length)return pokemonList;
    try{
      var cached=localStorage.getItem(LIST_CACHE_KEY);
      if(cached){pokemonList=JSON.parse(cached);if(pokemonList.length)return pokemonList}
    }catch(e){}
    var res=await fetch(API+"/pokemon-species?limit=2000");
    if(!res.ok)throw new Error("PokéAPI species request failed");
    var data=await res.json();
    pokemonList=data.results.map(function(p){return p.name});
    try{localStorage.setItem(LIST_CACHE_KEY,JSON.stringify(pokemonList))}catch(e){}
    return pokemonList;
  }

  async function searchPokemon(query){
    var results=$("#pokemonResults");
    var q=query.toLowerCase().trim().replace(/\s+/g,"-");
    if(q.length<2){results.hidden=true;return}
    results.hidden=false;results.innerHTML='<button class="search-result" disabled>Searching…</button>';
    try{
      await ensurePokemonList();
      var matches=pokemonList.filter(function(name){return name.indexOf(q)!==-1}).sort(function(a,b){
        var as=a.indexOf(q),bs=b.indexOf(q);return as-bs||a.length-b.length;
      }).slice(0,12);
      if(!matches.length){results.innerHTML='<button class="search-result" disabled>No matches</button>';return}
      results.innerHTML=matches.map(function(slug){return '<button class="search-result" data-pokemon="'+escapeHtml(slug)+'">'+escapeHtml(prettyName(slug))+'</button>'}).join("");
    }catch(err){
      results.innerHTML='<button class="search-result" disabled>Search unavailable</button>';
    }
  }

  async function choosePokemon(speciesSlug){
    $("#pokemonResults").hidden=true;
    var speciesName=prettyName(speciesSlug);
    $("#pokemonSearch").value=speciesName;
    $("#editorPokemonName").textContent="Loading "+speciesName+"…";
    try{
      var speciesRes=await fetch(API+"/pokemon-species/"+encodeURIComponent(speciesSlug));
      if(!speciesRes.ok)throw new Error("Species request failed");
      var speciesData=await speciesRes.json();
      var forms=(speciesData.varieties||[]).map(function(v){
        return {slug:v.pokemon.name,isDefault:!!v.is_default};
      }).sort(function(a,b){return Number(b.isDefault)-Number(a.isDefault)});
      if(!forms.length)forms=[{slug:speciesSlug,isDefault:true}];
      var selected=forms.filter(function(v){return v.isDefault})[0]||forms[0];
      await choosePokemonVariety(speciesSlug,selected.slug,forms,false);
    }catch(err){
      $("#editorPokemonName").textContent=speciesName;
      showToast("Could not load Pokémon data");
    }
  }

  async function choosePokemonVariety(speciesSlug,varietySlug,forms,fromFormChange){
    var speciesName=prettyName(speciesSlug);
    $("#editorPokemonName").textContent="Loading "+speciesName+"…";
    try{
      var res=await fetch(API+"/pokemon/"+encodeURIComponent(varietySlug));
      if(!res.ok)throw new Error("Pokémon request failed");
      var data=await res.json();
      var image=(data.sprites&&data.sprites.other&&data.sprites.other.home&&data.sprites.other.home.front_default)||
        (data.sprites&&data.sprites.other&&data.sprites.other["official-artwork"]&&data.sprites.other["official-artwork"].front_default)||
        (data.sprites&&data.sprites.front_default)||"";
      var abilities=(data.abilities||[]).map(function(a){return a.ability.name});
      var moves=(data.moves||[]).map(function(m){return m.move.name});
      var chosenForm=(forms||[]).filter(function(v){return v.slug===varietySlug})[0]||{slug:varietySlug,isDefault:varietySlug===speciesSlug};
      var mon={
        speciesSlug:speciesSlug,slug:varietySlug,name:speciesName,
        form:formLabel(speciesSlug,varietySlug,chosenForm.isDefault),availableForms:forms||[],
        image:image,types:(data.types||[]).map(function(t){return prettyName(t.type.name)}),
        availableAbilities:abilities,availableMoves:moves
      };
      var previousAbilities=[];
      try{previousAbilities=JSON.parse($("#selectedPokemon").dataset.abilities||"[]")}catch(e){}
      var currentAbility=$("#abilityInput").value.trim();
      setEditorPokemon(mon);
      if(!currentAbility||fromFormChange&&previousAbilities.map(prettyName).indexOf(currentAbility)!==-1){
        $("#abilityInput").value=abilities[0]?prettyName(abilities[0]):"";
      }
    }catch(err){
      $("#editorPokemonName").textContent=speciesName;
      showToast("Could not load this form");
    }
  }

  async function hydrateExistingPokemon(mon){
    if(!mon||!mon.slug)return;
    try{
      var pokemonRes=await fetch(API+"/pokemon/"+encodeURIComponent(mon.slug));
      if(!pokemonRes.ok)return;
      var pokemonData=await pokemonRes.json();
      var speciesSlug=mon.speciesSlug||(pokemonData.species&&pokemonData.species.name)||"";
      if(!speciesSlug)return;
      var speciesRes=await fetch(API+"/pokemon-species/"+encodeURIComponent(speciesSlug));
      if(!speciesRes.ok)return;
      var speciesData=await speciesRes.json();
      var forms=(speciesData.varieties||[]).map(function(v){return {slug:v.pokemon.name,isDefault:!!v.is_default}}).sort(function(a,b){return Number(b.isDefault)-Number(a.isDefault)});
      mon.speciesSlug=speciesSlug;
      mon.name=prettyName(speciesSlug);
      mon.form=formLabel(speciesSlug,mon.slug,(forms.filter(function(v){return v.slug===mon.slug})[0]||{}).isDefault);
      mon.availableForms=forms;
      mon.availableAbilities=(pokemonData.abilities||[]).map(function(a){return a.ability.name});
      mon.availableMoves=(pokemonData.moves||[]).map(function(m){return m.move.name});
      setEditorPokemon(mon);
      $("#pokemonSearch").value=mon.name;
    }catch(e){}
  }

  function collectEditor(){
    var selected=$("#selectedPokemon");
    var existing=state.team[state.editingIndex]||blankMon();
    var mon=blankMon();
    mon.speciesSlug=selected.dataset.speciesSlug||existing.speciesSlug||"";
    mon.slug=selected.dataset.slug||existing.slug||"";
    mon.name=selected.dataset.name||existing.name||$("#pokemonSearch").value.trim();
    mon.form=selected.dataset.form||existing.form||"";
    try{mon.availableForms=JSON.parse(selected.dataset.forms||"[]")}catch(e){mon.availableForms=[]}
    mon.image=selected.dataset.image||existing.image||"";
    try{mon.types=JSON.parse(selected.dataset.types||"[]")}catch(e){mon.types=[]}
    try{mon.availableAbilities=JSON.parse(selected.dataset.abilities||"[]")}catch(e){mon.availableAbilities=[]}
    try{mon.availableMoves=JSON.parse(selected.dataset.moves||"[]")}catch(e){mon.availableMoves=[]}
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
    mon.moves=$(".move-input").map(function(input){return input.value.trim()});
    mon.moveTypes=mon.moves.map(function(move,index){
      return existing.moves&&existing.moves[index]===move&&existing.moveTypes?existing.moveTypes[index]||"":"";
    });
    mon.moveClasses=mon.moves.map(function(move,index){
      return existing.moves&&existing.moves[index]===move&&existing.moveClasses?existing.moveClasses[index]||"":"";
    });
    return mon;
  }

  function saveEditor(){
    var mon=collectEditor();
    if(!mon.name){showToast("Choose or enter a Pokémon first");return}
    state.team[state.editingIndex]=mon;markDirty();renderTeam();closeEditor();showToast(mon.name+" saved");
  }

  function removeEditor(){
    if(state.editingIndex==null)return;
    state.team[state.editingIndex]=null;markDirty();renderTeam();closeEditor();showToast("Pokémon removed");
  }

  function syncMeta(trackDirty){
    var changed=false;
    ["playerName","trainerName","playerId","yearOfBirth"].forEach(function(key){
      var next=$("#"+key).value.trim();
      if(state.meta[key]!==next)changed=true;
      state.meta[key]=next;
    });
    if(changed&&trackDirty!==false)markDirty();
    else saveState(true);
  }
  function populateMeta(){
    ["playerName","trainerName","playerId","yearOfBirth"].forEach(function(key){$("#"+key).value=state.meta[key]||""});
  }

  function moveSlug(name){
    return String(name||"").trim().toLowerCase().replace(/[’']/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
  }

  function loadMoveMetaCache(){
    if(moveMetaCache)return moveMetaCache;
    try{moveMetaCache=JSON.parse(localStorage.getItem(MOVE_META_CACHE_KEY)||"{}")}catch(e){moveMetaCache={}}
    return moveMetaCache;
  }

  function saveMoveMetaCache(){
    try{localStorage.setItem(MOVE_META_CACHE_KEY,JSON.stringify(moveMetaCache||{}))}catch(e){}
  }

  async function getMoveMeta(name){
    var slug=moveSlug(name);
    if(!slug)return {type:"",damageClass:""};
    var cache=loadMoveMetaCache();
    if(cache[slug])return cache[slug];
    try{
      var res=await fetch(API+"/move/"+encodeURIComponent(slug));
      if(!res.ok)throw new Error("Move lookup failed");
      var data=await res.json();
      cache[slug]={
        type:prettyName(data.type&&data.type.name||""),
        damageClass:prettyName(data.damage_class&&data.damage_class.name||"")
      };
      saveMoveMetaCache();
      return cache[slug];
    }catch(e){
      cache[slug]={type:"",damageClass:""};
      saveMoveMetaCache();
      return cache[slug];
    }
  }

  async function hydrateMoveMeta(mons){
    var changed=false;
    await Promise.all((mons||[]).map(async function(mon){
      mon.moveTypes=Array.isArray(mon.moveTypes)?mon.moveTypes.slice(0,4):["","","",""];
      mon.moveClasses=Array.isArray(mon.moveClasses)?mon.moveClasses.slice(0,4):["","","",""];
      while(mon.moveTypes.length<4)mon.moveTypes.push("");
      while(mon.moveClasses.length<4)mon.moveClasses.push("");
      await Promise.all((mon.moves||[]).slice(0,4).map(async function(move,index){
        if(!move){return}
        if(mon.moveTypes[index]&&mon.moveClasses[index])return;
        var meta=await getMoveMeta(move);
        if(meta.type&&mon.moveTypes[index]!==meta.type){mon.moveTypes[index]=meta.type;changed=true}
        if(meta.damageClass&&mon.moveClasses[index]!==meta.damageClass){mon.moveClasses[index]=meta.damageClass;changed=true}
      }));
    }));
    if(changed)saveState(true);
    return changed;
  }

  function moveTypeKey(type){
    return String(type||"").toLowerCase().replace(/[^a-z]/g,"")||"unknown";
  }

  function typeIconHtml(type,className){
    var key=moveTypeKey(type);
    if(key==="unknown")return "";
    var base="/images/types/"+key;
    return '<img class="'+className+'" src="'+base+'.png" alt="'+escapeHtml(type)+'" '+
      'onerror="if(!this.dataset.fallback){this.dataset.fallback=\'webp\';this.src=\''+base+'.webp\'}else if(this.dataset.fallback===\'webp\'){this.dataset.fallback=\'svg\';this.src=\''+base+'.svg\'}else{this.style.display=\'none\'}">';
  }

  function moveTile(move,type,damageClass,printMode){
    var cls=printMode?"print-move":"paper-move";
    var key=moveTypeKey(type);
    var label=move||"—";
    var typeText=type||"Move";
    return '<div class="'+cls+' move-type-'+key+'" title="'+escapeHtml(typeText+(damageClass?" · "+damageClass:""))+'">'+
      '<span class="'+cls+'-name">'+escapeHtml(label)+'</span>'+
      (damageClass?'<small>'+escapeHtml(damageClass)+'</small>':'')+
      '<span class="move-type-badge" aria-label="'+escapeHtml(typeText)+'">'+typeIconHtml(type,"move-type-icon")+'</span>'+
    '</div>';
  }

  function monTypePills(mon,printMode){
    var cls=printMode?"print-mon-types":"paper-mon-types";
    return '<div class="'+cls+'">'+(mon.types||[]).map(function(type){
      return '<span class="mon-type type-'+moveTypeKey(type)+'">'+typeIconHtml(type,"mon-type-icon")+'<span>'+escapeHtml(type)+'</span></span>';
    }).join("")+'</div>';
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

  function renderPreview(skipHydrate){
    syncMeta(false);
    var mode=state.sheetMode;
    $("[data-sheet-mode='full']").classList.toggle("is-selected",mode==="full");
    $("[data-sheet-mode='open']").classList.toggle("is-selected",mode==="open");
    var completed=state.team.filter(function(m){return m&&m.name});

    var teamHtml=completed.map(function(mon){
      var extras=monExtra(mon,mode).map(function(x){return "<span>"+escapeHtml(x)+"</span>"}).join("");
      var moves=(mon.moves||[]).filter(Boolean).map(function(move,index){
        return moveTile(move,(mon.moveTypes||[])[index],(mon.moveClasses||[])[index],false);
      }).join("");
      if(!moves)moves='<div class="paper-move move-type-unknown"><span class="paper-move-name">No moves entered</span><span class="move-type-badge">•</span></div>';

      return '<article class="paper-mon">'+
        '<div class="paper-mon-art">'+(mon.image?'<img src="'+escapeHtml(mon.image)+'" alt="">':'')+'</div>'+
        '<div class="paper-mon-body">'+
          '<div class="paper-mon-top">'+
            '<div><div class="paper-mon-name">'+escapeHtml(displayMonName(mon))+'</div>'+monTypePills(mon,false)+'</div>'+
            '<span class="paper-level">Lv. '+escapeHtml(mon.level||50)+'</span>'+
          '</div>'+
          '<div class="paper-details">'+
            '<div><small>Ability</small><strong>'+escapeHtml(mon.ability||"—")+'</strong></div>'+
            '<div><small>Held Item</small><strong>'+escapeHtml(mon.item||"—")+'</strong></div>'+
          '</div>'+
          '<div class="paper-moves">'+moves+'</div>'+
          '<div class="paper-extra">'+extras+'</div>'+
          (mode==="full"?'<div class="paper-stats">'+statHtml(mon,true)+'</div>':'')+
        '</div>'+
      '</article>';
    }).join("");

    if(!teamHtml)teamHtml='<p style="color:#777;font-size:12px">Add Pokémon to your team to see the generated sheet.</p>';

    $("#screenPreview").innerHTML=
      '<header class="paper-header">'+
        '<div class="paper-brand"><span>TEAM LIST</span><h2>VGC Team List</h2><p>'+escapeHtml(gameConfig[state.game].name)+' · '+(mode==="full"?"Full / registration":"Open team sheet")+'</p></div>'+
        '<div class="paper-meta"><strong>'+escapeHtml(state.meta.playerName||"Player")+'</strong>'+escapeHtml(state.meta.trainerName||"Trainer name")+(state.meta.playerId?'<br>Player ID: '+escapeHtml(state.meta.playerId):'')+(state.meta.yearOfBirth?'<br>Year of birth: '+escapeHtml(state.meta.yearOfBirth):'')+'</div>'+
      '</header>'+
      '<div class="paper-team">'+teamHtml+'</div>';

    renderPrint();

    if(!skipHydrate&&completed.length){
      hydrateMoveMeta(completed).then(function(changed){
        if(changed&&$("#previewView").classList.contains("is-active"))renderPreview(true);
      });
    }
  }

  function renderPrint(){
    var mode=state.sheetMode;
    var completed=state.team.filter(function(m){return m&&m.name});
    var mons=completed.map(function(mon){
      var moves=(mon.moves||[]).map(function(move,index){
        return moveTile(move||"—",(mon.moveTypes||[])[index],(mon.moveClasses||[])[index],true);
      }).join("");
      var extraBits=monExtra(mon,mode).filter(function(bit){return bit.indexOf("Lv. ")!==0});
      return '<article class="print-mon">'+
        '<div class="print-mon-head">'+
          '<div class="print-mon-art">'+(mon.image?'<img src="'+escapeHtml(mon.image)+'" alt="">':'')+'</div>'+
          '<div class="print-mon-title">'+
            '<div class="print-title-line"><h2>'+escapeHtml(displayMonName(mon))+'</h2><span>Lv. '+escapeHtml(mon.level||50)+'</span></div>'+
            monTypePills(mon,true)+
            (extraBits.length?'<p>'+escapeHtml(extraBits.join(" · "))+'</p>':'')+
          '</div>'+
        '</div>'+
        '<div class="print-mon-body">'+
          '<div class="print-row"><b>Ability</b><span>'+escapeHtml(mon.ability||"—")+'</span></div>'+
          '<div class="print-row"><b>Held Item</b><span>'+escapeHtml(mon.item||"—")+'</span></div>'+
          '<div class="print-moves">'+moves+'</div>'+
          (mode==="full"?'<div class="print-stats">'+printStatHtml(mon,true)+'</div>':'')+
        '</div>'+
      '</article>';
    }).join("");

    $("#printRoot").innerHTML=
      '<section class="print-sheet">'+
        '<header class="print-head"><div><span>TEAM LIST</span><h1>VGC Team List</h1><p>'+escapeHtml(gameConfig[state.game].name)+' · '+(mode==="full"?"Full / registration copy":"Open team sheet")+'</p></div>'+
        '<div class="print-meta"><strong>'+escapeHtml(state.meta.playerName||"Player")+'</strong>Trainer: '+escapeHtml(state.meta.trainerName||"—")+(state.meta.playerId?'<br>Player ID: '+escapeHtml(state.meta.playerId):'')+(state.meta.yearOfBirth?'<br>Year of birth: '+escapeHtml(state.meta.yearOfBirth):'')+'</div></header>'+
        '<div class="print-team">'+mons+'</div>'+
        '<div class="print-foot">Generated with VGC Team Lists · Verify all information against the game before tournament submission.</div>'+
      '</section>';
  }

  function shareTeam(){
    var completed=state.team.filter(function(m){return m&&m.name});
    if(!completed.length){showToast("Add at least one Pokémon before sharing");return}
    var lines=["VGC Team",gameConfig[state.game].name,""];
    completed.forEach(function(mon){
      lines.push(displayMonName(mon)+" @ "+(mon.item||"No item"));
      lines.push("Ability: "+(mon.ability||"—"));
      if(mon.moves)mon.moves.filter(Boolean).forEach(function(m){lines.push("- "+m)});
      lines.push("");
    });
    var text=lines.join("\n");
    if(navigator.share){
      navigator.share({title:"VGC Team List",text:text,url:location.href}).catch(function(){});
    }else if(navigator.clipboard){
      navigator.clipboard.writeText(text).then(function(){showToast("Team copied to clipboard")});
    }else{showToast("Sharing is not available in this browser")}
  }

  function clearTeam(){
    if(!confirm("Clear all six Pokémon from this team?"))return;
    state.team=blankTeam();markDirty();renderTeam();showToast("Team cleared");
  }

  function wireEvents(){
    $$("[data-select-game]").forEach(function(b){b.addEventListener("click",function(){
      var dialog=b.closest("#newTeamDialog");
      if(dialog&&dialog.open)dialog.close();
      selectGame(b.dataset.selectGame);
    })});
    $("#openNewTeamDialog").addEventListener("click",function(){
      var dialog=$("#newTeamDialog");
      if(dialog&&typeof dialog.showModal==="function")dialog.showModal();
    });
    $("#closeNewTeamDialog").addEventListener("click",function(){$("#newTeamDialog").close()});
    $("#newTeamDialog").addEventListener("click",function(e){if(e.target===this)this.close()});
    $$("[data-nav]").forEach(function(b){b.addEventListener("click",function(){navigate(b.dataset.nav)})});
    $("#teamGrid").addEventListener("click",function(e){var slot=e.target.closest(".team-slot");if(slot)openEditor(Number(slot.dataset.slot))});
    $("#closeEditorButton").addEventListener("click",closeEditor);
    $("#savePokemonButton").addEventListener("click",saveEditor);
    $("#removePokemonButton").addEventListener("click",removeEditor);
    $("#pokemonSearch").addEventListener("input",function(e){searchPokemon(e.target.value)});
    $("#pokemonResults").addEventListener("click",function(e){var hit=e.target.closest("[data-pokemon]");if(hit)choosePokemon(hit.dataset.pokemon)});
    $("#formSelect").addEventListener("change",function(e){
      var selected=$("#selectedPokemon");
      var forms=[];
      try{forms=JSON.parse(selected.dataset.forms||"[]")}catch(err){}
      if(selected.dataset.speciesSlug&&e.target.value)choosePokemonVariety(selected.dataset.speciesSlug,e.target.value,forms,true);
    });
    $("#editorBackdrop").addEventListener("input",function(e){
      if(e.target.matches(".autocomplete-field input"))showFieldSuggestions(e.target,false);
    });
    $("#editorBackdrop").addEventListener("focusin",function(e){
      if(e.target.matches(".autocomplete-field input"))showFieldSuggestions(e.target,true);
    });
    $("#editorBackdrop").addEventListener("click",function(e){
      var caret=e.target.closest("[data-open-suggestions]");
      if(caret){
        var input=$("#"+caret.dataset.openSuggestions);
        var panel=$('[data-results-for="'+input.id+'"]');
        if(panel&&!panel.hidden){panel.hidden=true}else{showFieldSuggestions(input,true)}
        return;
      }
      var option=e.target.closest("[data-field-value]");
      if(option){
        var target=$("#"+option.dataset.targetInput);
        if(target)target.value=option.dataset.fieldValue;
        var resultPanel=option.closest(".field-results");
        if(resultPanel)resultPanel.hidden=true;
        return;
      }
      if(!e.target.closest(".autocomplete-field"))closeFieldResults();
    });
    $("#saveLocalButton").addEventListener("click",saveLocalBuild);
    $("#clearTeamButton").addEventListener("click",clearTeam);
    ["playerName","trainerName","playerId","yearOfBirth"].forEach(function(id){$("#"+id).addEventListener("change",function(){syncMeta(true)})});
    $$("[data-sheet-mode]").forEach(function(b){b.addEventListener("click",function(){if(state.sheetMode!==b.dataset.sheetMode){state.sheetMode=b.dataset.sheetMode;markDirty()}renderPreview()})});
    $("#printButton").addEventListener("click",function(){renderPrint();window.print()});
    $("#shareButton").addEventListener("click",shareTeam);
    document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!$("#editorBackdrop").hidden)closeEditor()});
    window.addEventListener("beforeunload",function(e){
      if(state.activeBuild&&state.dirty){e.preventDefault();e.returnValue=""}
    });
  }

  window.VCGApp={
    exportTeam:function(){
      syncMeta(false);
      return JSON.parse(JSON.stringify({
        game:state.game,
        sheetMode:state.sheetMode,
        meta:state.meta,
        team:state.team
      }));
    },
    importTeam:function(payload){
      if(!payload||!Array.isArray(payload.team)||!gameConfig[payload.game])return false;
      if(state.activeBuild&&!leaveBuild())return false;
      state.game=payload.game;
      state.sheetMode=payload.sheetMode==="open"?"open":"full";
      state.activeBuild=true;
      state.dirty=false;
      state.meta=Object.assign({playerName:"",trainerName:"",playerId:"",yearOfBirth:""},payload.meta||{});
      state.team=payload.team.slice(0,6);
      while(state.team.length<6)state.team.push(null);
      document.body.dataset.game=state.game;
      $("#builderTitle").textContent=gameConfig[state.game].name;
      $("#builderGameArt").style.backgroundImage="url('"+gameConfig[state.game].art+"')";
      populateMeta();renderTeam();saveState(true);navigate("team",{skipBuildGuard:true});
      return true;
    },
    applyProfileDefaults:function(profile,overwrite){
      if(!profile)return;
      ["playerName","trainerName","playerId","yearOfBirth"].forEach(function(key){
        var value=profile[key];
        if(value!==null&&value!==undefined&&String(value)!==""&&(overwrite||!state.meta[key]))state.meta[key]=String(value);
      });
      populateMeta();saveState(true);
    },
    defaultTeamName:function(){
      return gameConfig[state.game].name+" team";
    },
    toast:showToast,
    navigate:navigate,
    routeTarget:routeTarget,
    markSaved:markSaved,
    hasActiveBuild:function(){return state.activeBuild},
    isDirty:function(){return state.dirty}
  };

  function init(){
    loadState();renderStatInputs();populateMeta();wireEvents();
    if(state.activeBuild&&state.game&&gameConfig[state.game]){
      document.body.dataset.game=state.game;
      $("#builderTitle").textContent=gameConfig[state.game].name;
      $("#builderGameArt").style.backgroundImage="url('"+gameConfig[state.game].art+"')";
    }
    renderTeam();

    var requested=routeTarget(location.pathname);
    if((requested==="team"||requested==="preview")&&!state.activeBuild)requested="home";
    navigate(requested,{skipHistory:true,instant:true,silent:true,skipBuildGuard:true});

    window.addEventListener("popstate",function(){
      var requestedTarget=routeTarget(location.pathname);
      var current=$(".view.is-active");
      var currentTarget=current&&current.id==="builderView"?"team":current&&current.id==="previewView"?"preview":current&&current.id==="teamsView"?"teams":current&&current.id==="profileView"?"profile":"home";
      if(!navigate(requestedTarget,{skipHistory:true,instant:true})){
        history.pushState({target:currentTarget},"",routePaths[currentTarget]||"/");
      }
    });
    if("serviceWorker" in navigator)window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})});
  }

  document.addEventListener("DOMContentLoaded",init);
})();