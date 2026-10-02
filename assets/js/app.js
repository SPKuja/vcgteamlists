(function(){
  "use strict";

  var API="https://pokeapi.co/api/v2";
  var STORAGE_KEY="vcg-teamlists-v2";
  var LEGACY_STORAGE_KEY="vcg-teamlists-v1";
  var LOCAL_SAVE_KEY="vcg-saved-build-v1";
  var LIST_CACHE_KEY="vcg-pokemon-species-list-v2";
  var MOVE_META_CACHE_KEY="vcg-move-meta-v1";
  var ITEM_META_CACHE_KEY="vcg-item-meta-v1";
  var NATURE_META_CACHE_KEY="vcg-nature-meta-v1";
  var GO_DATA_CACHE_KEY="vcg-go-data-v1";
  var GO_POKEMON_URL="https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster/pokemon.json";
  var GO_MOVES_URL="https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster/moves.json";
  var statKeys=["hp","attack","defense","specialAttack","specialDefense","speed"];
  var statLabels={hp:"HP",attack:"Atk",defense:"Def",specialAttack:"SpA",specialDefense:"SpD",speed:"Spe"};
  var gameConfig={
    champions:{name:"Pokémon Champions",subtitle:"Stat Alignment, Stat Points and final battle stats.",art:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/6.png",alignmentLabel:"Stat Alignment",statPoints:true,tera:false,gmax:false,showLevel:false},
    sv:{name:"Scarlet / Violet",subtitle:"Tera Type, nature/alignment, level and final stats.",art:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/1008.png",alignmentLabel:"Nature",statPoints:false,tera:true,gmax:false,showLevel:true},
    swsh:{name:"Sword / Shield",subtitle:"Nature, level, final stats and Gigantamax capability.",art:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/888.png",alignmentLabel:"Nature",statPoints:false,tera:false,gmax:true,showLevel:true},
    go:{name:"Pokémon GO",subtitle:"Three-Pokémon PvP teams with league, CP, IVs and GO move pools.",art:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/184.png",alignmentLabel:"",statPoints:false,tera:false,gmax:false,showLevel:false,go:true,teamSize:3},
    custom:{name:"Custom / Other",subtitle:"A flexible team sheet for custom or legacy formats.",art:"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",alignmentLabel:"Nature / Alignment",statPoints:false,tera:false,gmax:false,showLevel:true}
  };

  var state={
    game:null,sheetMode:"full",editingIndex:null,activeBuild:false,dirty:false,
    meta:{playerName:"",trainerName:"",playerId:"",yearOfBirth:"",goLeague:"great",goCpCap:"1500"},
    team:[null,null,null,null,null,null]
  };
  var pokemonList=[];
  var resourceLists={ability:null,item:null,nature:null,move:null};
  var moveMetaCache=null;
  var itemMetaCache=null;
  var natureMetaCache=null;
  var goData=null;
  var statsCache=null;
  var statsLoadedAt=0;
  var statsLoading=false;
  var toastTimer=null;
  var editorScrollLockY=0;

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
    return {speciesSlug:"",slug:"",name:"",form:"",availableForms:[],image:"",types:[],availableAbilities:[],availableMoves:[],ability:"",item:"",itemImage:"",gender:"",level:50,alignment:"",alignmentUp:"",alignmentDown:"",teraType:"",gigantamax:false,stats:emptyStats(),statPoints:emptyStats(),evs:null,ivs:null,moves:["","","",""],moveTypes:["","","",""],moveClasses:["","","",""],goSpeciesId:"",goDex:null,goCP:"",goLevel:"",goIVs:{attack:"",defense:"",hp:""},goShadow:false,goFastMoves:[],goChargedMoves:[]};
  }

  function teamSize(game){
    return gameConfig[game||state.game]&&gameConfig[game||state.game].teamSize||6;
  }

  function normaliseTeamLength(team,game){
    var size=teamSize(game);
    var out=Array.isArray(team)?team.slice(0,size):[];
    while(out.length<size)out.push(null);
    return out;
  }
  function shouldAutoFocus(){
    return !window.matchMedia || window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function lockEditorPageScroll(){
    editorScrollLockY=window.scrollY||window.pageYOffset||0;
    document.documentElement.classList.add("editor-open");
    document.body.classList.add("editor-open");
    document.body.style.position="fixed";
    document.body.style.top="-"+editorScrollLockY+"px";
    document.body.style.left="0";
    document.body.style.right="0";
    document.body.style.width="100%";
    document.body.style.overflow="hidden";
  }

  function unlockEditorPageScroll(){
    document.documentElement.classList.remove("editor-open");
    document.body.classList.remove("editor-open");
    document.body.style.position="";
    document.body.style.top="";
    document.body.style.left="";
    document.body.style.right="";
    document.body.style.width="";
    document.body.style.overflow="";
    window.scrollTo(0,editorScrollLockY);
  }

  function goLeagueInfo(){
    var league=state.meta.goLeague||"great";
    if(league==="ultra")return {name:"Ultra League",cap:2500,key:"cp2500"};
    if(league==="master")return {name:"Master League",cap:null,key:null};
    if(league==="custom")return {name:"Custom League",cap:Number(state.meta.goCpCap)||1500,key:null};
    return {name:"Great League",cap:1500,key:"cp1500"};
  }

  function configureGameUi(){
    var isGo=state.game==="go";
    var goSettings=$("#goTeamSettings");
    if(goSettings)goSettings.hidden=!isGo;
    var eyebrow=$("#teamSlotEyebrow");
    if(eyebrow)eyebrow.textContent=isGo?"Three slots":"Six slots";
    var showdownImport=$("#openShowdownImport");
    if(showdownImport)showdownImport.hidden=isGo;
    var sheetMode=$("#sheetModeControl");
    if(sheetMode)sheetMode.hidden=isGo;
    var showdownExport=$("#showdownExportButton");
    if(showdownExport)showdownExport.hidden=isGo;
    var previewTitle=$("#previewTitle");
    if(previewTitle)previewTitle.textContent=isGo?"GO team preview":"Team sheet preview";
    if(isGo)state.sheetMode="full";
  }

  async function ensureGoData(){
    if(goData&&goData.pokemon&&goData.moves)return goData;
    var results=await Promise.all([
      fetch(GO_POKEMON_URL,{cache:"default"}),
      fetch(GO_MOVES_URL,{cache:"default"})
    ]);
    if(!results[0].ok||!results[1].ok)throw new Error("Pokémon GO data is temporarily unavailable");
    var payloads=await Promise.all([results[0].json(),results[1].json()]);
    var pokemon=payloads[0]||[],moves=payloads[1]||[];
    var moveById={},moveSlugMap={};
    moves.forEach(function(move){
      moveById[move.moveId]=move;
      moveSlugMap[moveSlug(move.name||move.moveId)]=move;
    });
    goData={pokemon:pokemon.filter(function(mon){return mon&&mon.released!==false}),moves:moves,moveById:moveById,moveSlugMap:moveSlugMap};
    return goData;
  }

  function goArtworkUrl(mon){
    var dex=Number(mon&&mon.dex)||0;
    return dex?"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/"+dex+".png":"";
  }

  function goMoveName(id){
    if(goData&&goData.moveById&&goData.moveById[id])return goData.moveById[id].name||prettyName(String(id).toLowerCase().replace(/_/g,"-"));
    return prettyName(String(id||"").toLowerCase().replace(/_/g,"-"));
  }

  function goMoveSlug(id){
    return moveSlug(goMoveName(id));
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
        state.team=normaliseTeamLength(saved.team,saved.game);
      }
    }catch(err){console.warn("Could not restore team",err)}
  }

  function blankTeam(game){return Array(teamSize(game)).fill(null)}

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
    var previousGame=state.game;
    state.game=null;
    state.sheetMode="full";
    state.editingIndex=null;
    state.activeBuild=false;
    state.dirty=false;
    state.team=blankTeam(previousGame);
    configureGameUi();
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
    state.team=blankTeam(game);
    document.body.dataset.game=game;
    $("#builderTitle").textContent=gameConfig[game].name;
    $("#builderGameArt").style.backgroundImage="url('"+gameConfig[game].art+"')";
    configureGameUi();
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
        state.team=normaliseTeamLength(saved.team,game);
        document.body.dataset.game=game;
        $("#builderTitle").textContent=gameConfig[game].name;
        $("#builderGameArt").style.backgroundImage="url('"+gameConfig[game].art+"')";
        configureGameUi();
        populateMeta();renderTeam();saveState(true);navigate("team");
        return;
      }
    }

    startNewBuild(game);
    navigate("team");
  }

  var routePaths={home:"/",team:"/team-builder",teams:"/my-teams",stats:"/stats",preview:"/preview",profile:"/profile"};

  function routeTarget(pathname){
    var path=(pathname||"/").replace(/\/+$/,"")||"/";
    if(path==="/team-builder")return "team";
    if(path==="/my-teams")return "teams";
    if(path==="/stats")return "stats";
    if(path==="/preview")return "preview";
    if(path==="/profile")return "profile";
    return "home";
  }

  function navigate(target,options){
    options=options||{};
    var current=$(".view.is-active");
    var currentTarget=current&&current.id==="builderView"?"team":current&&current.id==="previewView"?"preview":current&&current.id==="teamsView"?"teams":current&&current.id==="statsView"?"stats":current&&current.id==="profileView"?"profile":"home";
    var leavingBuild=(currentTarget==="team"||currentTarget==="preview")&&(target!=="team"&&target!=="preview");

    if(leavingBuild&&!options.skipBuildGuard){
      if(!leaveBuild())return false;
    }

    if((target==="team"||target==="preview")&&!state.activeBuild){
      target="home";
      if(!options.silent)showToast("Choose a game before opening the team builder");
    }

    $$(".view").forEach(function(v){v.classList.remove("is-active")});
    var id=target==="home"?"homeView":target==="preview"?"previewView":target==="teams"?"teamsView":target==="stats"?"statsView":target==="profile"?"profileView":"builderView";
    $("#"+id).classList.add("is-active");
    $$(".bottom-nav button").forEach(function(b){b.classList.toggle("is-active",b.dataset.nav===target)});
    if(target==="preview")renderPreview();
    if(target==="stats")loadStats(false);

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

  var defensiveChart={
    normal:[["fighting"],[],["ghost"]],fire:[["water","ground","rock"],["fire","grass","ice","bug","steel","fairy"],[]],
    water:[["electric","grass"],["fire","water","ice","steel"],[]],electric:[["ground"],["electric","flying","steel"],[]],
    grass:[["fire","ice","poison","flying","bug"],["water","electric","grass","ground"],[]],ice:[["fire","fighting","rock","steel"],["ice"],[]],
    fighting:[["flying","psychic","fairy"],["bug","rock","dark"],[]],poison:[["ground","psychic"],["grass","fighting","poison","bug","fairy"],[]],
    ground:[["water","grass","ice"],["poison","rock"],["electric"]],flying:[["electric","ice","rock"],["grass","fighting","bug"],["ground"]],
    psychic:[["bug","ghost","dark"],["fighting","psychic"],[]],bug:[["fire","flying","rock"],["grass","fighting","ground"],[]],
    rock:[["water","grass","fighting","ground","steel"],["normal","fire","poison","flying"],[]],ghost:[["ghost","dark"],["poison","bug"],["normal","fighting"]],
    dragon:[["ice","dragon","fairy"],["fire","water","electric","grass"],[]],dark:[["fighting","bug","fairy"],["ghost","dark"],["psychic"]],
    steel:[["fire","fighting","ground"],["normal","grass","ice","flying","psychic","bug","rock","dragon","steel","fairy"],["poison"]],
    fairy:[["poison","steel"],["fighting","bug","dark"],["dragon"]]
  };
  var battleTypes=Object.keys(defensiveChart);

  function matchupMultiplier(attacking,types){
    return (types||[]).reduce(function(mult,type){
      var chart=defensiveChart[moveTypeKey(type)];
      if(!chart)return mult;
      if(chart[2].indexOf(attacking)>=0)return 0;
      if(chart[0].indexOf(attacking)>=0)return mult*2;
      if(chart[1].indexOf(attacking)>=0)return mult*.5;
      return mult;
    },1);
  }

  function renderTeamInsights(mons){
    var root=$("#teamInsights");
    if(!root)return;
    if(!mons||mons.length<2){
      root.innerHTML='<div class="team-insights-empty"><span class="eyebrow">Team insights</span><strong>Add at least two Pokémon to see team-wide matchups.</strong></div>';
      return;
    }

    var rows=battleTypes.map(function(type){
      var row={type:type,weak:0,four:0,resist:0,immune:0,severity:0};
      mons.forEach(function(mon){
        var mult=matchupMultiplier(type,mon.types||[]);
        if(mult===0)row.immune++;
        else if(mult>1){row.weak++;row.severity+=mult;if(mult>=4)row.four++}
        else if(mult<1)row.resist++;
      });
      return row;
    });

    var weak=rows.filter(function(x){return x.weak}).sort(function(a,b){
      return b.weak-a.weak||b.four-a.four||b.severity-a.severity;
    }).slice(0,4);
    var answers=rows.filter(function(x){return x.resist+x.immune}).sort(function(a,b){
      return (b.resist+b.immune)-(a.resist+a.immune)||b.immune-a.immune;
    }).slice(0,4);
    var unique={};
    mons.forEach(function(mon){(mon.types||[]).forEach(function(t){unique[moveTypeKey(t)]=1})});

    function chip(row,kind){
      var label=prettyName(row.type);
      var detail=kind==="weak"
        ? row.weak+" weak"+(row.four?" · "+row.four+" ×4":"")
        : (row.resist+row.immune)+" answer"+((row.resist+row.immune)===1?"":"s")+(row.immune?" · "+row.immune+" immune":"");
      return '<div class="insight-type type-'+row.type+'">'+typeIconHtml(label,"insight-type-icon")+
        '<span><strong>'+escapeHtml(label)+'</strong><small>'+escapeHtml(detail)+'</small></span></div>';
    }

    var lead=weak[0] ? prettyName(weak[0].type)+" affects "+weak[0].weak+" of "+mons.length+" Pokémon." : "No shared weaknesses found.";
    root.innerHTML=
      '<div class="team-insights-head"><div><span class="eyebrow">Team insights</span><h2>Defensive profile</h2></div>'+
      '<div class="insight-summary-stats"><span><strong>'+mons.length+'</strong> Pokémon</span><span><strong>'+Object.keys(unique).length+'</strong> unique types</span></div></div>'+
      '<div class="team-insights-grid">'+
        '<article class="insight-panel weakness-panel"><div class="insight-panel-title"><span class="insight-symbol">!</span><div><h3>Major weaknesses</h3><p>'+escapeHtml(lead)+'</p></div></div><div class="insight-types">'+weak.map(function(x){return chip(x,"weak")}).join("")+'</div></article>'+
        '<article class="insight-panel answer-panel"><div class="insight-panel-title"><span class="insight-symbol">✓</span><div><h3>Defensive answers</h3><p>Attack types your team resists or is immune to most often.</p></div></div><div class="insight-types">'+answers.map(function(x){return chip(x,"answer")}).join("")+'</div></article>'+
      '</div><p class="insight-note">'+(state.game==="go"?"Type-based overview only. PvP moves, shields, energy and battle timing can change practical matchups.":"Type-based analysis only. Abilities, held items, moves and battle effects can change practical matchups.")+'</p>';
  }

  function renderTeam(){
    var grid=$("#teamGrid");grid.innerHTML="";
    var complete=0;
    var size=teamSize(state.game);
    state.team=normaliseTeamLength(state.team,state.game);
    state.team.forEach(function(mon,index){
      var button=document.createElement("button");
      button.className="team-slot"+(mon&&mon.name?"":" empty")+(state.game==="go"?" go-team-slot":"");
      button.dataset.slot=index;
      if(!mon||!mon.name){
        button.innerHTML='<span class="slot-number">SLOT '+(index+1)+'</span><span class="add-orb">+</span><strong>Add Pokémon</strong><small>Choose a Pokémon for this slot</small>';
      }else{
        complete++;
        var types=(mon.types||[]).map(function(t){
          return '<span class="type-pill type-'+moveTypeKey(t)+'">'+typeIconHtml(t,"slot-type-icon")+'<span>'+escapeHtml(t)+'</span></span>';
        }).join("");
        if(state.game==="go"){
          var ivs=mon.goIVs||{};
          var cp=mon.goCP!==""&&mon.goCP!=null?escapeHtml(mon.goCP):"—";
          var level=mon.goLevel!==""&&mon.goLevel!=null?escapeHtml(mon.goLevel):"—";
          var fast=(mon.moves||[])[0]||"—";
          var charges=(mon.moves||[]).slice(1,3).filter(Boolean).join(" · ")||"—";
          button.innerHTML=
            '<span class="slot-number">SLOT '+(index+1)+'</span>'+
            '<span class="slot-edit">Edit <span>›</span></span>'+
            '<div class="slot-img">'+(mon.image?'<img src="'+escapeHtml(mon.image)+'" alt="">':'')+'</div>'+
            '<div class="slot-copy">'+
              '<div class="slot-name">'+escapeHtml(mon.name)+'</div>'+
              '<div class="slot-types">'+types+'</div>'+
              '<div class="go-slot-badges"><span>CP '+cp+'</span><span>Lv. '+level+'</span>'+(mon.goShadow?'<span class="go-shadow-badge">Shadow</span>':'')+'</div>'+
              '<div class="slot-info-grid go-slot-info">'+
                '<div><small>IVs</small><span>'+escapeHtml(ivs.attack||0)+' / '+escapeHtml(ivs.defense||0)+' / '+escapeHtml(ivs.hp||0)+'</span></div>'+
                '<div><small>Fast move</small><span>'+escapeHtml(fast)+'</span></div>'+
                '<div class="go-charge-row"><small>Charged moves</small><span>'+escapeHtml(charges)+'</span></div>'+
              '</div>'+
            '</div>';
        }else{
          var item='<span class="slot-info-value">'+(mon.itemImage?'<img class="slot-item-icon" src="'+escapeHtml(mon.itemImage)+'" alt="">':'')+escapeHtml(mon.item||"No item")+'</span>';
          var traits=[];
          if(mon.alignment)traits.push('<span class="slot-trait">'+escapeHtml(mon.alignment)+'</span>');
          if(mon.gender){
            var genderSymbol=mon.gender==="Male"?"♂":mon.gender==="Female"?"♀":"◇";
            traits.push('<span class="slot-trait gender-'+mon.gender.toLowerCase()+'">'+genderSymbol+' '+escapeHtml(mon.gender)+'</span>');
          }
          button.innerHTML=
            '<span class="slot-number">SLOT '+(index+1)+'</span>'+
            '<span class="slot-edit">Edit <span>›</span></span>'+
            '<div class="slot-img">'+(mon.image?'<img src="'+escapeHtml(mon.image)+'" alt="">':'')+'</div>'+
            '<div class="slot-copy">'+
              '<div class="slot-name">'+escapeHtml(displayMonName(mon))+'</div>'+
              '<div class="slot-types">'+types+'</div>'+
              (traits.length?'<div class="slot-traits">'+traits.join("")+'</div>':'')+
              '<div class="slot-info-grid">'+
                '<div><small>Ability</small><span>'+escapeHtml(mon.ability||"No ability")+'</span></div>'+
                '<div><small>Held item</small>'+item+'</div>'+
              '</div>'+
            '</div>';
        }
      }
      grid.appendChild(button);
    });
    var completion=$("#completionCount");
    completion.textContent=complete===size?"✓ "+size+" / "+size+" ready":complete+" / "+size+" complete";
    completion.classList.toggle("is-complete",complete===size);

    var completedMons=state.team.filter(function(mon){return mon&&mon.name});
    renderTeamInsights(completedMons);
    if(state.game!=="go"&&completedMons.some(function(mon){return mon.item&&!mon.itemImage})){
      hydrateItemMeta(completedMons).then(function(changed){if(changed)renderTeam()});
    }
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
    var standard=$("#standardBattleFields"),finalSection=$("#finalStatsSection"),pointsSection=$("#statPointsSection");
    var moveFields=$$("#movesSection .autocomplete-field");
    if(state.game==="go"){
      if(standard)standard.hidden=true;
      if(finalSection)finalSection.hidden=true;
      if(pointsSection)pointsSection.hidden=true;
      $("#movesNumber").textContent="02";
      $("#movesTitle").textContent="PvP moves";
      ["Fast move","Charged move 1","Charged move 2",""].forEach(function(label,index){
        var labelEl=$("#moveLabel"+index),field=moveFields[index],input=$("#moveInput"+index);
        if(labelEl&&label)labelEl.textContent=label;
        if(field)field.hidden=index===3;
        if(input){
          input.dataset.goMoveKind=index===0?"fast":"charged";
          input.placeholder=index===0?"Search fast moves":"Search charged moves";
        }
      });
      var ivs=mon.goIVs||{};
      wrap.innerHTML=
        '<div class="go-pokemon-fields">'+
          '<div class="form-grid two">'+
            '<label><span>CP</span><input id="goCpInput" type="number" inputmode="numeric" min="10" max="10000" placeholder="e.g. 1498"></label>'+
            '<label><span>Pokémon level</span><input id="goLevelInput" type="number" inputmode="decimal" min="1" max="51" step="0.5" placeholder="e.g. 20.5"></label>'+
          '</div>'+
          '<div class="go-iv-grid">'+
            '<label><span>Attack IV</span><input id="goIvAttack" type="number" inputmode="numeric" min="0" max="15"></label>'+
            '<label><span>Defense IV</span><input id="goIvDefense" type="number" inputmode="numeric" min="0" max="15"></label>'+
            '<label><span>HP IV</span><input id="goIvHp" type="number" inputmode="numeric" min="0" max="15"></label>'+
          '</div>'+
          '<label class="inline-toggle"><div><strong>Shadow Pokémon</strong><small>Uses the Shadow version where available.</small></div><input id="goShadowInput" type="checkbox"></label>'+
        '</div>';
      $("#goCpInput").value=mon.goCP||"";
      $("#goLevelInput").value=mon.goLevel||"";
      $("#goIvAttack").value=ivs.attack!==undefined?ivs.attack:"";
      $("#goIvDefense").value=ivs.defense!==undefined?ivs.defense:"";
      $("#goIvHp").value=ivs.hp!==undefined?ivs.hp:"";
      $("#goShadowInput").checked=!!mon.goShadow;
      return;
    }

    if(standard)standard.hidden=false;
    if(finalSection)finalSection.hidden=false;
    if(pointsSection){pointsSection.hidden=false;pointsSection.style.display=config.statPoints?"block":"none"}
    $("#movesTitle").textContent="Moves";
    ["Move 1","Move 2","Move 3","Move 4"].forEach(function(label,index){
      var labelEl=$("#moveLabel"+index),field=moveFields[index],input=$("#moveInput"+index);
      if(labelEl)labelEl.textContent=label;
      if(field)field.hidden=false;
      if(input){delete input.dataset.goMoveKind;input.placeholder="Search moves"}
    });

    var alignmentPlaceholder=state.game==="champions"?"Search stat alignments":"Search natures";
    var html='<div class="form-grid two" style="margin-top:10px"><div class="autocomplete-field" data-resource="nature"><label for="alignmentInput">'+escapeHtml(config.alignmentLabel)+'</label><div class="autocomplete-control"><input id="alignmentInput" autocomplete="off" placeholder="'+escapeHtml(alignmentPlaceholder)+'"><button type="button" class="field-caret" data-open-suggestions="alignmentInput" aria-label="Show alignments">⌄</button></div><div class="field-results" data-results-for="alignmentInput" hidden></div></div>';
    if(config.tera)html+='<label><span>Tera Type</span><input id="teraInput" placeholder="e.g. Grass"></label>';
    html+='</div>';
    if(config.gmax)html+='<label class="inline-toggle"><div><strong>Gigantamax capable</strong></div><input id="gmaxInput" type="checkbox"></label>';
    wrap.innerHTML=html;
    $("#statPointsSection").style.display=config.statPoints?"block":"none";
    $("#levelField").hidden=config.showLevel===false;
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
    if(mon.name){
      if(state.game==="go")hydrateExistingGoPokemon(mon);
      else hydrateExistingPokemon(mon);
    }
    $("#removePokemonButton").style.visibility=mon.name?"visible":"hidden";
    $("#editorBackdrop").hidden=false;
    lockEditorPageScroll();
    (state.game==="go"
      ? ensureGoData()
      : Promise.all([ensureResourceList("ability"),ensureResourceList("item"),ensureResourceList("nature"),ensureResourceList("move")])
    ).catch(function(){});
    if(shouldAutoFocus())setTimeout(function(){$("#pokemonSearch").focus()},180);
  }

  function closeEditor(){
    $("#editorBackdrop").hidden=true;
    $("#pokemonResults").hidden=true;
    closeFieldResults();
    unlockEditorPageScroll();
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
    $("#selectedPokemon").dataset.goSpeciesId=mon.goSpeciesId||"";
    $("#selectedPokemon").dataset.goDex=mon.goDex||"";
    $("#selectedPokemon").dataset.goFastMoves=JSON.stringify(mon.goFastMoves||[]);
    $("#selectedPokemon").dataset.goChargedMoves=JSON.stringify(mon.goChargedMoves||[]);
    $("#selectedPokemon").dataset.goShadow=mon.goShadow?"1":"";
    if(state.game==="go"){
      $("#formField").hidden=true;
      $("#formSelect").innerHTML="";
    }else{
      renderFormSelector(mon);
    }
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

  function fieldPriority(resource,input){
    var raw="[]";
    if(resource==="ability")raw=$("#selectedPokemon").dataset.abilities||"[]";
    if(resource==="move"){
      if(state.game==="go"&&input&&input.dataset.goMoveKind==="fast")raw=$("#selectedPokemon").dataset.goFastMoves||"[]";
      else if(state.game==="go"&&input&&input.dataset.goMoveKind==="charged")raw=$("#selectedPokemon").dataset.goChargedMoves||"[]";
      else raw=$("#selectedPokemon").dataset.moves||"[]";
    }
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
      var list;
      if(state.game==="go"&&resource==="move"){
        var data=await ensureGoData();
        var kind=input.dataset.goMoveKind||"";
        list=data.moves.filter(function(move){
          if(kind==="fast")return Number(move.energyGain)>0;
          if(kind==="charged")return Number(move.energy)>0;
          return true;
        }).map(function(move){return moveSlug(move.name||move.moveId)});
      }else{
        list=await ensureResourceList(resource);
      }
      var priority=fieldPriority(resource,input);
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

  async function searchGoPokemon(query){
    var results=$("#pokemonResults");
    var q=String(query||"").toLowerCase().trim();
    if(q.length<2){results.hidden=true;return}
    results.hidden=false;results.innerHTML='<button class="search-result" disabled>Searching GO data…</button>';
    try{
      var data=await ensureGoData();
      var matches=data.pokemon.filter(function(mon){
        return String(mon.speciesName||"").toLowerCase().indexOf(q)!==-1||String(mon.speciesId||"").toLowerCase().replace(/_/g," ").indexOf(q)!==-1;
      }).sort(function(a,b){
        var an=String(a.speciesName||"").toLowerCase(),bn=String(b.speciesName||"").toLowerCase();
        return an.indexOf(q)-bn.indexOf(q)||an.length-bn.length;
      }).slice(0,18);
      if(!matches.length){results.innerHTML='<button class="search-result" disabled>No GO matches</button>';return}
      results.innerHTML=matches.map(function(mon){
        var shadow=(mon.tags||[]).indexOf("shadow")!==-1;
        return '<button class="search-result go-search-result" data-pokemon="'+escapeHtml(mon.speciesId)+'"><strong>'+escapeHtml(mon.speciesName)+'</strong><small>'+escapeHtml((mon.types||[]).map(prettyName).join(" / "))+(shadow?" · Shadow":"")+'</small></button>';
      }).join("");
    }catch(err){
      results.innerHTML='<button class="search-result" disabled>GO data unavailable</button>';
    }
  }

  async function chooseGoPokemon(speciesId){
    $("#pokemonResults").hidden=true;
    try{
      var data=await ensureGoData();
      var entry=data.pokemon.filter(function(mon){return mon.speciesId===speciesId})[0];
      if(!entry)throw new Error("GO Pokémon not found");
      var shadow=(entry.tags||[]).indexOf("shadow")!==-1;
      var name=entry.speciesName||prettyName(speciesId.replace(/_/g,"-"));
      var league=goLeagueInfo();
      var defaults=league.key&&entry.defaultIVs&&entry.defaultIVs[league.key]?entry.defaultIVs[league.key]:null;
      var mon=blankMon();
      mon.speciesSlug=String(entry.dex||"");
      mon.slug=speciesId;
      mon.name=name;
      mon.form="Standard";
      mon.image=goArtworkUrl(entry);
      mon.types=(entry.types||[]).map(prettyName);
      mon.goSpeciesId=speciesId;
      mon.goDex=entry.dex||null;
      mon.goShadow=shadow;
      mon.goFastMoves=(entry.fastMoves||[]).map(goMoveSlug);
      mon.goChargedMoves=(entry.chargedMoves||[]).map(goMoveSlug);
      mon.availableMoves=mon.goFastMoves.concat(mon.goChargedMoves);
      if(defaults){
        mon.goLevel=defaults[0];
        mon.goIVs={attack:defaults[1],defense:defaults[2],hp:defaults[3]};
      }
      setEditorPokemon(mon);
      $("#pokemonSearch").value=name;
      renderGameFields(mon);
      $("#moveInput0").value=entry.fastMoves&&entry.fastMoves[0]?goMoveName(entry.fastMoves[0]):"";
      $("#moveInput1").value=entry.chargedMoves&&entry.chargedMoves[0]?goMoveName(entry.chargedMoves[0]):"";
      $("#moveInput2").value=entry.chargedMoves&&entry.chargedMoves[1]?goMoveName(entry.chargedMoves[1]):"";
    }catch(err){
      console.error("Could not load GO Pokémon",err);
      showToast("Could not load Pokémon GO data");
    }
  }

  async function hydrateExistingGoPokemon(mon){
    if(!mon||!mon.goSpeciesId)return;
    try{
      var data=await ensureGoData();
      var entry=data.pokemon.filter(function(item){return item.speciesId===mon.goSpeciesId})[0];
      if(!entry)return;
      mon.goDex=entry.dex||mon.goDex;
      mon.types=(entry.types||[]).map(prettyName);
      mon.image=mon.image||goArtworkUrl(entry);
      mon.goFastMoves=(entry.fastMoves||[]).map(goMoveSlug);
      mon.goChargedMoves=(entry.chargedMoves||[]).map(goMoveSlug);
      mon.availableMoves=mon.goFastMoves.concat(mon.goChargedMoves);
      setEditorPokemon(mon);
      $("#pokemonSearch").value=mon.name||entry.speciesName||"";
    }catch(e){}
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
    if(state.game==="go")return searchGoPokemon(query);
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
    if(state.game==="go")return chooseGoPokemon(speciesSlug);
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

    if(state.game==="go"){
      mon.goSpeciesId=selected.dataset.goSpeciesId||existing.goSpeciesId||mon.slug;
      mon.goDex=Number(selected.dataset.goDex||existing.goDex)||null;
      try{mon.goFastMoves=JSON.parse(selected.dataset.goFastMoves||"[]")}catch(e){mon.goFastMoves=[]}
      try{mon.goChargedMoves=JSON.parse(selected.dataset.goChargedMoves||"[]")}catch(e){mon.goChargedMoves=[]}
      mon.goShadow=!!($("#goShadowInput")&&$("#goShadowInput").checked);
      mon.goCP=$("#goCpInput")?$("#goCpInput").value.trim():"";
      mon.goLevel=$("#goLevelInput")?$("#goLevelInput").value.trim():"";
      mon.goIVs={
        attack:$("#goIvAttack")?$("#goIvAttack").value.trim():"",
        defense:$("#goIvDefense")?$("#goIvDefense").value.trim():"",
        hp:$("#goIvHp")?$("#goIvHp").value.trim():""
      };
      mon.moves=[
        $("#moveInput0").value.trim(),
        $("#moveInput1").value.trim(),
        $("#moveInput2").value.trim(),
        ""
      ];
      mon.moveTypes=mon.moves.map(function(move){
        var meta=goData&&goData.moveSlugMap?goData.moveSlugMap[moveSlug(move)]:null;
        return meta?prettyName(meta.type):"";
      });
      mon.moveClasses=["Fast","Charged","Charged",""];
      return mon;
    }

    mon.ability=$("#abilityInput").value.trim();
    mon.item=$("#itemInput").value.trim();
    mon.itemImage=existing.item===mon.item?(existing.itemImage||""):"";
    mon.gender=$("#genderInput").value;
    mon.level=Number($("#levelInput").value)||50;
    mon.alignment=$("#alignmentInput")?$("#alignmentInput").value.trim():"";
    mon.alignmentUp=existing.alignment===mon.alignment?(existing.alignmentUp||""):"";
    mon.alignmentDown=existing.alignment===mon.alignment?(existing.alignmentDown||""):"";
    mon.teraType=$("#teraInput")?$("#teraInput").value.trim():"";
    mon.gigantamax=$("#gmaxInput")?$("#gmaxInput").checked:false;
    mon.evs=existing.evs||null;
    mon.ivs=existing.ivs||null;
    statKeys.forEach(function(key){
      mon.stats[key]=$('[data-final-stat="'+key+'"]').value.trim();
      mon.statPoints[key]=$('[data-point-stat="'+key+'"]').value.trim();
    });
    mon.moves=$$(".move-input").map(function(input){return input.value.trim()});
    mon.moveTypes=mon.moves.map(function(move,index){
      return existing.moves&&existing.moves[index]===move&&existing.moveTypes?existing.moveTypes[index]||"":"";
    });
    mon.moveClasses=mon.moves.map(function(move,index){
      return existing.moves&&existing.moves[index]===move&&existing.moveClasses?existing.moveClasses[index]||"":"";
    });
    return mon;
  }

  function saveEditor(){
    var mon;
    try{
      mon=collectEditor();
    }catch(err){
      console.error("Could not collect Pokémon details",err);
      showToast("Could not save Pokémon — check the entered details");
      return;
    }
    if(!mon.name){showToast("Choose or enter a Pokémon first");return}
    if(state.game==="go"){
      var league=goLeagueInfo();
      var cp=Number(mon.goCP)||0;
      var ivs=mon.goIVs||{};
      if(league.cap&&cp>league.cap){showToast("CP exceeds the "+league.name+" cap of "+league.cap);return}
      if(["attack","defense","hp"].some(function(key){var value=Number(ivs[key]);return value<0||value>15})){
        showToast("Pokémon GO IVs must be between 0 and 15");
        return;
      }
    }
    state.team[state.editingIndex]=mon;
    markDirty();
    closeEditor();
    try{
      renderTeam();
    }catch(err){
      console.error("Pokémon saved, but the team overview could not refresh",err);
    }
    showToast(mon.name+" saved");
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
    if(state.game==="go"){
      var league=$("#goLeague")?$("#goLeague").value:"great";
      var cap=$("#goCpCap")?$("#goCpCap").value.trim():"1500";
      if(state.meta.goLeague!==league||String(state.meta.goCpCap||"")!==cap)changed=true;
      state.meta.goLeague=league;
      state.meta.goCpCap=cap;
    }
    if(changed&&trackDirty!==false)markDirty();
    else saveState(true);
  }
  function populateMeta(){
    ["playerName","trainerName","playerId","yearOfBirth"].forEach(function(key){$("#"+key).value=state.meta[key]||""});
    if($("#goLeague"))$("#goLeague").value=state.meta.goLeague||"great";
    if($("#goCpCap")){
      $("#goCpCap").value=state.meta.goCpCap||"1500";
      $("#goCpCap").disabled=(state.meta.goLeague||"great")==="master";
    }
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

  function loadItemMetaCache(){
    if(itemMetaCache)return itemMetaCache;
    try{itemMetaCache=JSON.parse(localStorage.getItem(ITEM_META_CACHE_KEY)||"{}")}catch(e){itemMetaCache={}}
    return itemMetaCache;
  }

  function saveItemMetaCache(){
    try{localStorage.setItem(ITEM_META_CACHE_KEY,JSON.stringify(itemMetaCache||{}))}catch(e){}
  }

  async function getItemMeta(name){
    var slug=moveSlug(name);
    if(!slug)return {image:""};
    var cache=loadItemMetaCache();
    if(cache[slug])return cache[slug];
    try{
      var res=await fetch(API+"/item/"+encodeURIComponent(slug));
      if(!res.ok)throw new Error("Item lookup failed");
      var data=await res.json();
      cache[slug]={image:data.sprites&&data.sprites.default?data.sprites.default:""};
      saveItemMetaCache();
      return cache[slug];
    }catch(e){
      cache[slug]={image:""};
      saveItemMetaCache();
      return cache[slug];
    }
  }

  async function hydrateItemMeta(mons){
    var changed=false;
    await Promise.all((mons||[]).map(async function(mon){
      if(!mon.item||mon.itemImage)return;
      var meta=await getItemMeta(mon.item);
      if(meta.image&&mon.itemImage!==meta.image){
        mon.itemImage=meta.image;
        changed=true;
      }
    }));
    if(changed)saveState(true);
    return changed;
  }

  function itemDetailHtml(mon,printMode){
    var cls=printMode?"print-item-detail":"paper-item-detail";
    return '<span class="'+cls+'">'+
      (mon.itemImage?'<img src="'+escapeHtml(mon.itemImage)+'" alt="" loading="eager">':'')+
      '<strong>'+escapeHtml(mon.item||"—")+'</strong>'+
    '</span>';
  }

  function loadNatureMetaCache(){
    if(natureMetaCache)return natureMetaCache;
    try{natureMetaCache=JSON.parse(localStorage.getItem(NATURE_META_CACHE_KEY)||"{}")}catch(e){natureMetaCache={}}
    return natureMetaCache;
  }

  function saveNatureMetaCache(){
    try{localStorage.setItem(NATURE_META_CACHE_KEY,JSON.stringify(natureMetaCache||{}))}catch(e){}
  }

  function natureStatLabel(slug){
    return {attack:"Atk",defense:"Def","special-attack":"SpA","special-defense":"SpD",speed:"Spe"}[slug]||prettyName(slug);
  }

  async function getNatureMeta(name){
    var slug=moveSlug(name);
    if(!slug)return {up:"",down:""};
    var cache=loadNatureMetaCache();
    if(cache[slug])return cache[slug];
    try{
      var res=await fetch(API+"/nature/"+encodeURIComponent(slug));
      if(!res.ok)throw new Error("Nature lookup failed");
      var data=await res.json();
      cache[slug]={
        up:data.increased_stat?natureStatLabel(data.increased_stat.name):"",
        down:data.decreased_stat?natureStatLabel(data.decreased_stat.name):""
      };
      saveNatureMetaCache();
      return cache[slug];
    }catch(e){
      cache[slug]={up:"",down:""};
      saveNatureMetaCache();
      return cache[slug];
    }
  }

  async function hydrateNatureMeta(mons){
    var changed=false;
    await Promise.all((mons||[]).map(async function(mon){
      if(!mon.alignment||(mon.alignmentUp||mon.alignmentDown))return;
      var meta=await getNatureMeta(mon.alignment);
      if(meta.up!==mon.alignmentUp){mon.alignmentUp=meta.up;changed=true}
      if(meta.down!==mon.alignmentDown){mon.alignmentDown=meta.down;changed=true}
    }));
    if(changed)saveState(true);
    return changed;
  }

  function alignmentChipHtml(mon,printMode){
    if(!mon.alignment)return "";
    var cls=printMode?"print-trait-chip":"paper-trait-chip";
    var effects="";
    if(mon.alignmentUp||mon.alignmentDown){
      effects='<span class="nature-effects">'+
        (mon.alignmentUp?'<b class="nature-up">'+escapeHtml(mon.alignmentUp)+' ↑</b>':'')+
        (mon.alignmentDown?'<b class="nature-down">'+escapeHtml(mon.alignmentDown)+' ↓</b>':'')+
      '</span>';
    }
    return '<span class="'+cls+' nature-chip"><small>'+escapeHtml(gameConfig[state.game].alignmentLabel)+'</small><strong>'+escapeHtml(mon.alignment)+'</strong>'+effects+'</span>';
  }

  function genderChipHtml(mon,printMode){
    if(!mon.gender)return "";
    var cls=printMode?"print-trait-chip":"paper-trait-chip";
    var symbol=mon.gender==="Male"?"♂":mon.gender==="Female"?"♀":"◇";
    var genderClass=mon.gender==="Male"?"male":mon.gender==="Female"?"female":"neutral";
    return '<span class="'+cls+' gender-chip '+genderClass+'"><b>'+symbol+'</b><strong>'+escapeHtml(mon.gender)+'</strong></span>';
  }

  function traitChipsHtml(mon,printMode){
    var content=alignmentChipHtml(mon,printMode)+genderChipHtml(mon,printMode);
    return content?'<div class="'+(printMode?"print-traits":"paper-traits")+'">'+content+'</div>':"";
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
    if(state.game==="sv"&&mon.teraType)bits.push("Tera: "+mon.teraType);
    if(state.game==="swsh"&&mon.gigantamax)bits.push("Gigantamax: Yes");
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

  function renderGoPreview(){
    syncMeta(false);
    var league=goLeagueInfo();
    var completed=state.team.filter(function(m){return m&&m.name});
    var cards=completed.map(function(mon){
      var ivs=mon.goIVs||{};
      var moveHtml=(mon.moves||[]).slice(0,3).filter(Boolean).map(function(move,index){
        return '<div class="go-paper-move"><small>'+(index===0?"FAST":"CHARGED")+'</small><strong>'+escapeHtml(move)+'</strong></div>';
      }).join("");
      return '<article class="go-paper-mon">'+
        '<div class="go-paper-art">'+(mon.image?'<img src="'+escapeHtml(mon.image)+'" alt="">':'')+'</div>'+
        '<div class="go-paper-body">'+
          '<div class="go-paper-top"><div><h3>'+escapeHtml(mon.name)+'</h3>'+monTypePills(mon,false)+'</div>'+(mon.goShadow?'<span class="go-shadow-badge">Shadow</span>':'')+'</div>'+
          '<div class="go-paper-stats"><div><small>CP</small><strong>'+escapeHtml(mon.goCP||"—")+'</strong></div><div><small>Level</small><strong>'+escapeHtml(mon.goLevel||"—")+'</strong></div><div><small>IVs A/D/HP</small><strong>'+escapeHtml(ivs.attack||0)+' / '+escapeHtml(ivs.defense||0)+' / '+escapeHtml(ivs.hp||0)+'</strong></div></div>'+
          '<div class="go-paper-moves">'+moveHtml+'</div>'+
        '</div>'+
      '</article>';
    }).join("");
    if(!cards)cards='<p style="color:#777;font-size:12px">Add Pokémon to your GO team to see the generated card.</p>';

    $("#screenPreview").innerHTML=
      '<header class="paper-header go-paper-header">'+
        '<div class="paper-brand"><span>POKÉMON GO</span><h2>'+escapeHtml(league.name)+' Team</h2><p>'+(league.cap?"CP cap "+league.cap:"No CP cap")+' · 3 Pokémon</p></div>'+
        '<div class="paper-meta"><strong>'+escapeHtml(state.meta.playerName||"Trainer")+'</strong>'+escapeHtml(state.meta.trainerName||"")+'</div>'+
      '</header>'+
      '<div class="go-paper-team">'+cards+'</div>'+
      '<p class="go-data-credit">PvP species and move data sourced from PvPoke gamemaster.</p>';
    renderGoPrint();
  }

  function renderGoPrint(){
    var league=goLeagueInfo();
    var completed=state.team.filter(function(m){return m&&m.name});
    var cards=completed.map(function(mon){
      var ivs=mon.goIVs||{};
      return '<article class="go-print-mon">'+
        '<div class="go-print-art">'+(mon.image?'<img src="'+escapeHtml(mon.image)+'" alt="">':'')+'</div>'+
        '<div class="go-print-copy"><h2>'+escapeHtml(mon.name)+'</h2><p>CP '+escapeHtml(mon.goCP||"—")+' · Lv. '+escapeHtml(mon.goLevel||"—")+' · IVs '+escapeHtml(ivs.attack||0)+'/'+escapeHtml(ivs.defense||0)+'/'+escapeHtml(ivs.hp||0)+(mon.goShadow?" · Shadow":"")+'</p>'+
        '<ul>'+(mon.moves||[]).slice(0,3).filter(Boolean).map(function(move){return '<li>'+escapeHtml(move)+'</li>'}).join("")+'</ul></div>'+
      '</article>';
    }).join("");
    $("#printRoot").innerHTML='<section class="print-sheet go-print-sheet"><header class="print-head"><div><span>POKÉMON GO</span><h1>'+escapeHtml(league.name)+' Team</h1><p>'+(league.cap?"CP cap "+league.cap:"No CP cap")+'</p></div><div class="print-meta"><strong>'+escapeHtml(state.meta.playerName||"Trainer")+'</strong>'+escapeHtml(state.meta.trainerName||"")+'</div></header><div class="go-print-team">'+cards+'</div><div class="print-foot">Generated with VGC Team Lists · Pokémon GO data via PvPoke gamemaster.</div></section>';
  }

  function renderPreview(skipHydrate){
    if(state.game==="go"){renderGoPreview();return}
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
            '<div><div class="paper-mon-name">'+escapeHtml(displayMonName(mon))+'</div>'+monTypePills(mon,false)+traitChipsHtml(mon,false)+'</div>'+
            (gameConfig[state.game].showLevel===false?'':'<span class="paper-level">Lv. '+escapeHtml(mon.level||50)+'</span>')+
          '</div>'+
          '<div class="paper-details">'+
            '<div><small>Ability</small><strong>'+escapeHtml(mon.ability||"—")+'</strong></div>'+
            '<div><small>Held Item</small>'+itemDetailHtml(mon,false)+'</div>'+
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
      Promise.all([hydrateMoveMeta(completed),hydrateItemMeta(completed),hydrateNatureMeta(completed)]).then(function(results){
        if((results[0]||results[1]||results[2])&&$("#previewView").classList.contains("is-active"))renderPreview(true);
      });
    }
  }

  function renderPrint(){
    if(state.game==="go"){renderGoPrint();return}
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
            '<div class="print-title-line"><h2>'+escapeHtml(displayMonName(mon))+'</h2>'+(gameConfig[state.game].showLevel===false?'':'<span>Lv. '+escapeHtml(mon.level||50)+'</span>')+'</div>'+
            monTypePills(mon,true)+traitChipsHtml(mon,true)+
            (extraBits.length?'<p>'+escapeHtml(extraBits.join(" · "))+'</p>':'')+
          '</div>'+
        '</div>'+
        '<div class="print-mon-body">'+
          '<div class="print-row"><b>Ability</b><span>'+escapeHtml(mon.ability||"—")+'</span></div>'+
          '<div class="print-row"><b>Held Item</b>'+itemDetailHtml(mon,true)+'</div>'+
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

  function waitForImage(img){
    if(!img)return Promise.resolve();
    if(img.complete&&img.naturalWidth>0){
      if(typeof img.decode==="function")return img.decode().catch(function(){});
      return Promise.resolve();
    }
    return new Promise(function(resolve){
      var done=false;
      function finish(){if(done)return;done=true;resolve()}
      img.addEventListener("load",finish,{once:true});
      img.addEventListener("error",finish,{once:true});
      setTimeout(finish,4500);
    }).then(function(){
      if(img.complete&&img.naturalWidth>0&&typeof img.decode==="function")return img.decode().catch(function(){});
    });
  }

  async function printTeamSheet(){
    var completed=state.team.filter(function(m){return m&&m.name});
    if(completed.length&&state.game!=="go"){
      await Promise.all([hydrateMoveMeta(completed),hydrateItemMeta(completed),hydrateNatureMeta(completed)]);
    }
    renderPrint();
    var root=$("#printRoot");
    var images=$("img",root);
    if(images.length){
      await Promise.all(images.map(waitForImage));
    }
    if(document.fonts&&document.fonts.ready){
      try{await document.fonts.ready}catch(e){}
    }
    await new Promise(function(resolve){
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){
          setTimeout(resolve,150);
        });
      });
    });
    window.print();
  }

  function showdownExportSpecies(mon){
    if(!mon)return "";
    if(!mon.form||mon.form==="Standard")return mon.name||prettyName(mon.speciesSlug||mon.slug);
    var speciesSlug=mon.speciesSlug||showdownSlug(mon.name);
    var slug=mon.slug||speciesSlug;
    if(/-mask$/.test(slug))slug=slug.replace(/-mask$/,"");
    if(slug.indexOf(speciesSlug+"-")===0){
      var suffix=slug.slice(speciesSlug.length+1).split("-").map(function(part){
        return part?part.charAt(0).toUpperCase()+part.slice(1):"";
      }).join("-");
      return (mon.name||prettyName(speciesSlug))+"-"+suffix;
    }
    return mon.name||prettyName(slug);
  }

  function showdownSpreadLine(label,spread,defaults){
    if(!spread)return "";
    var parts=[];
    statKeys.forEach(function(key){
      var value=Number(spread[key]);
      if(!Number.isFinite(value))return;
      if(defaults&&value===defaults[key])return;
      if(!defaults&&value===0)return;
      parts.push(value+" "+statLabels[key]);
    });
    return parts.length?label+": "+parts.join(" / "):"";
  }

  function showdownExportText(){
    var completed=state.team.filter(function(m){return m&&m.name});
    return completed.map(function(mon){
      var lead=showdownExportSpecies(mon);
      if(mon.gender==="Male")lead+=" (M)";
      if(mon.gender==="Female")lead+=" (F)";
      if(mon.item)lead+=" @ "+mon.item;
      var lines=[lead];
      if(mon.ability)lines.push("Ability: "+mon.ability);
      if(gameConfig[state.game].showLevel!==false&&mon.level&&Number(mon.level)!==100)lines.push("Level: "+Number(mon.level));
      if(mon.teraType)lines.push("Tera Type: "+mon.teraType);
      var evLine=showdownSpreadLine("EVs",mon.evs,null);
      if(evLine)lines.push(evLine);
      var ivLine=showdownSpreadLine("IVs",mon.ivs,{hp:31,attack:31,defense:31,specialAttack:31,specialDefense:31,speed:31});
      if(ivLine)lines.push(ivLine);
      if(mon.alignment)lines.push(mon.alignment+" Nature");
      if(mon.gigantamax)lines.push("Gigantamax: Yes");
      (mon.moves||[]).filter(Boolean).forEach(function(move){lines.push("- "+move)});
      return lines.join("\n");
    }).join("\n\n");
  }

  async function exportShowdown(){
    var text=showdownExportText();
    if(!text){showToast("Add at least one Pokémon before exporting");return}
    if(navigator.clipboard&&navigator.clipboard.writeText){
      try{
        await navigator.clipboard.writeText(text);
        showToast("Showdown team copied to clipboard");
        return;
      }catch(e){}
    }
    var blob=new Blob([text],{type:"text/plain;charset=utf-8"});
    var url=URL.createObjectURL(blob);
    var link=document.createElement("a");
    link.href=url;link.download="pokemon-showdown-team.txt";document.body.appendChild(link);link.click();link.remove();
    setTimeout(function(){URL.revokeObjectURL(url)},1000);
    showToast("Showdown team downloaded");
  }

  function withTimeout(promise,ms,message){
    return Promise.race([
      promise,
      new Promise(function(_,reject){
        setTimeout(function(){reject(new Error(message||"Timed out"))},ms);
      })
    ]);
  }

  function loadExternalScript(src,test){
    if(test())return Promise.resolve();
    return new Promise(function(resolve,reject){
      var settled=false;
      var script=document.querySelector('script[data-runtime-src="'+src+'"]');

      function finish(ok){
        if(settled)return;
        settled=true;
        clearTimeout(timer);
        if(ok&&test())resolve();
        else reject(new Error("Could not load PDF tools"));
      }

      if(script&&script.dataset.runtimeStatus==="loaded"){
        finish(test());
        return;
      }
      if(script&&script.dataset.runtimeStatus==="failed"){
        script.remove();
        script=null;
      }
      if(!script){
        script=document.createElement("script");
        script.src=src;
        script.async=true;
        script.dataset.runtimeSrc=src;
        script.dataset.runtimeStatus="loading";
        document.head.appendChild(script);
      }

      script.addEventListener("load",function(){
        script.dataset.runtimeStatus="loaded";
        finish(true);
      },{once:true});
      script.addEventListener("error",function(){
        script.dataset.runtimeStatus="failed";
        finish(false);
      },{once:true});

      var timer=setTimeout(function(){
        if(script)script.dataset.runtimeStatus="failed";
        finish(false);
      },7000);
    });
  }

  async function loadFirstAvailable(sources,test){
    if(test())return;
    var lastError=null;
    for(var i=0;i<sources.length;i++){
      try{
        await loadExternalScript(sources[i],test);
        if(test())return;
      }catch(err){lastError=err}
    }
    throw lastError||new Error("Could not load PDF tools");
  }

  async function ensurePdfLibraries(){
    await loadFirstAvailable([
      "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"
    ],function(){return typeof window.html2canvas==="function"});

    await loadFirstAvailable([
      "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js"
    ],function(){return !!(window.jspdf&&window.jspdf.jsPDF)});
  }

  function safeTeamFilename(){
    var base=(state.meta.trainerName||state.meta.playerName||"VGC Team").trim().replace(/[^a-z0-9 _-]+/gi,"").replace(/\s+/g," ").trim();
    return (base||"VGC Team")+" - Team List.pdf";
  }

  async function createTeamPdfFile(onProgress){
    var completed=state.team.filter(function(m){return m&&m.name});
    if(!completed.length)throw new Error("Add at least one Pokémon before sharing");

    if(onProgress)onProgress("Preparing team…");
    try{
      await withTimeout(
        state.game==="go"?Promise.resolve([]):Promise.all([hydrateMoveMeta(completed),hydrateItemMeta(completed),hydrateNatureMeta(completed)]),
        9000,
        "Team data took too long to prepare"
      );
    }catch(err){
      console.warn("PDF metadata preparation timed out",err);
    }

    renderPreview(true);
    var preview=$("#screenPreview");

    if(onProgress)onProgress("Loading images…");
    await withTimeout(
      Promise.all($$("img",preview).map(waitForImage)),
      6500,
      "Images took too long to prepare"
    ).catch(function(err){console.warn("PDF image wait timed out",err)});

    if(document.fonts&&document.fonts.ready){
      await withTimeout(document.fonts.ready,2500,"Fonts took too long to load").catch(function(){});
    }

    if(onProgress)onProgress("Loading PDF tools…");
    await withTimeout(ensurePdfLibraries(),16000,"PDF tools could not be loaded");

    if(onProgress)onProgress("Rendering PDF…");
    var scale=window.innerWidth<700?1.5:2;
    var canvas=await withTimeout(
      window.html2canvas(preview,{
        scale:scale,
        useCORS:true,
        allowTaint:false,
        imageTimeout:5000,
        backgroundColor:"#ffffff",
        logging:false
      }),
      18000,
      "PDF rendering took too long"
    );

    var jsPDF=window.jspdf.jsPDF;
    var pdf=new jsPDF({orientation:"portrait",unit:"mm",format:"a4",compress:true});
    var pageWidth=210,pageHeight=297,margin=7;
    var ratio=Math.min((pageWidth-margin*2)/canvas.width,(pageHeight-margin*2)/canvas.height);
    var width=canvas.width*ratio,height=canvas.height*ratio;
    var x=(pageWidth-width)/2,y=(pageHeight-height)/2;
    pdf.addImage(canvas.toDataURL("image/jpeg",0.92),"JPEG",x,y,width,height,undefined,"FAST");
    var blob=pdf.output("blob");
    return new File([blob],safeTeamFilename(),{type:"application/pdf"});
  }

  async function shareTeam(){
    var completed=state.team.filter(function(m){return m&&m.name});
    if(!completed.length){showToast("Add at least one Pokémon before sharing");return}
    var button=$("#shareButton"),original=button?button.textContent:"Share PDF";
    if(button){button.disabled=true;button.textContent="Preparing PDF…"}
    try{
      var file=await createTeamPdfFile(function(label){if(button)button.textContent=label});
      if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){
        await navigator.share({title:"VGC Team List",text:gameConfig[state.game].name,files:[file]});
        showToast("Team PDF shared");
      }else{
        var url=URL.createObjectURL(file);
        var link=document.createElement("a");
        link.href=url;link.download=file.name;document.body.appendChild(link);link.click();link.remove();
        setTimeout(function(){URL.revokeObjectURL(url)},1500);
        showToast("PDF downloaded — attach it anywhere you like");
      }
    }catch(err){
      if(err&&err.name==="AbortError")return;
      console.error("PDF share failed",err);
      showToast(err&&err.message?err.message:"Could not create the PDF");
    }finally{
      if(button){button.disabled=false;button.textContent=original}
    }
  }

  function clearTeam(){
    if(!confirm("Clear all six Pokémon from this team?"))return;
    state.team=blankTeam(state.game);markDirty();renderTeam();showToast("Team cleared");
  }

  function formatStatNumber(value){
    return new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(Number(value)||0);
  }

  function statsGameName(game){
    return {champions:"Pokémon Champions",sv:"Scarlet / Violet",swsh:"Sword / Shield",go:"Pokémon GO",custom:"Custom / Other"}[game]||prettyName(game);
  }

  function itemSpriteCandidates(name,savedUrl){
    var slug=moveSlug(name);
    var base="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/";
    var candidates=[];
    if(savedUrl)candidates.push(savedUrl);
    if(slug){
      candidates.push(base+slug+".png");
      ["gen9","gen8","gen7","gen6","gen5","gen4","gen3"].forEach(function(gen){
        candidates.push(base+gen+"/"+slug+".png");
      });
    }
    return candidates.filter(function(url,index,list){return url&&list.indexOf(url)===index});
  }

  function wireItemSpriteFallbacks(root){
    $$("img[data-item-sources]",root).forEach(function(img){
      var sources=[];
      try{sources=JSON.parse(img.dataset.itemSources||"[]")}catch(e){}
      var index=0;
      function useNext(){
        index++;
        if(index>=sources.length){
          img.style.display="none";
          return;
        }
        img.src=sources[index];
      }
      img.addEventListener("error",useNext);
    });
  }

  function renderRankedStats(target,rows,total,withImages){
    var el=$(target);if(!el)return;
    if(!rows||!rows.length){
      el.innerHTML='<div class="stats-empty">Not enough saved team data yet.</div>';
      return;
    }
    var max=Math.max.apply(null,rows.map(function(row){return Number(row.count)||0}));
    el.innerHTML=rows.map(function(row,index){
      var count=Number(row.count)||0;
      var pct=total?Math.round((count/total)*100):0;
      var image="";
      if(withImages){
        var sources=itemSpriteCandidates(row.name,row.image);
        if(sources.length){
          image='<img src="'+escapeHtml(sources[0])+'" data-item-sources="'+escapeHtml(JSON.stringify(sources))+'" alt="" loading="lazy">';
        }
      }
      return '<div class="stats-ranked-row">'+
        '<span class="stats-rank">'+(index+1)+'</span>'+
        image+
        '<div class="stats-ranked-copy"><strong>'+escapeHtml(row.name||"—")+'</strong><span><i style="width:'+Math.max(6,Math.round((count/max)*100))+'%"></i></span></div>'+
        '<div class="stats-ranked-value"><strong>'+formatStatNumber(count)+'</strong>'+(total?'<small>'+pct+'%</small>':'')+'</div>'+
      '</div>';
    }).join("");
    if(withImages)wireItemSpriteFallbacks(el);
  }

  function renderStats(data){
    var overview=data.overview||{};
    $("#statUsers").textContent=formatStatNumber(overview.registeredUsers);
    $("#statTeams").textContent=formatStatNumber(overview.savedTeams);
    $("#statPokemonSlots").textContent=formatStatNumber(overview.pokemonSlots);
    $("#statUniquePokemon").textContent=formatStatNumber(overview.uniquePokemon);
    $("#statNewUsers").textContent=formatStatNumber(overview.newUsers30d);
    $("#statNewTeams").textContent=formatStatNumber(overview.newTeams30d);
    $("#statAverageTeam").textContent=(overview.averageTeamSize||0)+" Pokémon per saved team";

    var pokemon=data.popularPokemon||[];
    var pokemonTotal=Number(overview.pokemonSlots)||0;
    var pokemonList=$("#statsPokemonList");
    if(!pokemon.length){
      pokemonList.innerHTML='<div class="stats-empty">No saved Pokémon yet.</div>';
    }else{
      pokemonList.innerHTML=pokemon.map(function(row,index){
        var pct=pokemonTotal?Math.round((Number(row.count)||0)/pokemonTotal*100):0;
        return '<article class="stats-pokemon-row">'+
          '<span class="stats-pokemon-rank">'+(index+1)+'</span>'+
          '<div class="stats-pokemon-art">'+(row.image?'<img src="'+escapeHtml(row.image)+'" alt="" loading="lazy">':'<span>◉</span>')+'</div>'+
          '<div class="stats-pokemon-copy"><strong>'+escapeHtml(row.name||"Pokémon")+'</strong><span>'+formatStatNumber(row.count)+' team slots · '+pct+'%</span></div>'+
          '<div class="stats-pokemon-bar"><i style="width:'+Math.max(5,pct)+'%"></i></div>'+
        '</article>';
      }).join("");
    }

    var games=data.gameBreakdown||[];
    var gameMax=Math.max.apply(null,[1].concat(games.map(function(row){return Number(row.count)||0})));
    $("#statsGameBreakdown").innerHTML=games.map(function(row){
      var count=Number(row.count)||0;
      return '<div class="stats-bar-row"><div><strong>'+escapeHtml(statsGameName(row.game))+'</strong><span>'+formatStatNumber(count)+' team'+(count===1?'':'s')+'</span></div>'+
        '<span class="stats-bar-track"><i style="width:'+Math.round((count/gameMax)*100)+'%"></i></span></div>';
    }).join("");

    renderRankedStats("#statsItems",data.popularItems||[],pokemonTotal,true);
    renderRankedStats("#statsAbilities",data.popularAbilities||[],pokemonTotal,false);
    renderRankedStats("#statsAlignments",data.popularAlignments||[],pokemonTotal,false);

    var generated=data.generatedAt?new Date(data.generatedAt):new Date();
    $("#statsUpdated").textContent="Updated "+generated.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    $("#statsLoading").hidden=true;
    $("#statsError").hidden=true;
    $("#statsContent").hidden=false;
  }

  async function loadStats(force){
    if(statsLoading)return;
    if(!force&&statsCache&&(Date.now()-statsLoadedAt)<300000){
      renderStats(statsCache);
      return;
    }
    statsLoading=true;
    $("#statsLoading").hidden=false;
    $("#statsError").hidden=true;
    $("#statsContent").hidden=true;
    try{
      var response=await fetch("/api/stats.php",{headers:{"Accept":"application/json"}});
      if(!response.ok)throw new Error("Stats request failed");
      var data=await response.json();
      statsCache=data;statsLoadedAt=Date.now();
      renderStats(data);
    }catch(e){
      $("#statsLoading").hidden=true;
      $("#statsContent").hidden=true;
      $("#statsError").hidden=false;
      $("#statsUpdated").textContent="Unavailable";
    }finally{
      statsLoading=false;
    }
  }

  function showdownSlug(value){
    return String(value||"").trim().toLowerCase()
      .replace(/♀/g,"-f").replace(/♂/g,"-m")
      .replace(/[’']/g,"").replace(/[.:]/g," ")
      .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
  }

  function showdownStatKey(label){
    return {hp:"hp",atk:"attack",def:"defense",spa:"specialAttack",spd:"specialDefense",spe:"speed"}[String(label||"").toLowerCase()]||"";
  }

  function parseShowdownSpread(value,defaults){
    var out=Object.assign({},defaults||{});
    String(value||"").split("/").forEach(function(part){
      var match=part.trim().match(/^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/i);
      if(match){
        var key=showdownStatKey(match[2]);
        if(key)out[key]=Number(match[1]);
      }
    });
    return out;
  }

  function parseShowdownTeam(text){
    var blocks=String(text||"").replace(/\r/g,"").trim().split(/\n\s*\n+/).filter(function(block){return block.trim()});
    return blocks.slice(0,6).map(function(block){
      var lines=block.split("\n").map(function(line){return line.trim()}).filter(Boolean);
      if(!lines.length)return null;
      var first=lines.shift(),item="";
      var at=first.lastIndexOf(" @ ");
      if(at>=0){item=first.slice(at+3).trim();first=first.slice(0,at).trim()}

      var gender="";
      var genderMatch=first.match(/\s+\((M|F)\)$/i);
      if(genderMatch){
        gender=genderMatch[1].toUpperCase()==="M"?"Male":"Female";
        first=first.slice(0,genderMatch.index).trim();
      }

      var species=first,nickname="";
      var nickMatch=first.match(/^(.*?)\s*\(([^()]+)\)$/);
      if(nickMatch){
        nickname=nickMatch[1].trim();
        species=nickMatch[2].trim();
      }

      var set={
        species:species,nickname:nickname,item:item,ability:"",gender:gender,level:50,
        nature:"",teraType:"",gigantamax:false,moves:[],
        evs:{hp:0,attack:0,defense:0,specialAttack:0,specialDefense:0,speed:0},
        ivs:{hp:31,attack:31,defense:31,specialAttack:31,specialDefense:31,speed:31}
      };

      lines.forEach(function(line){
        if(/^Ability:\s*/i.test(line))set.ability=line.replace(/^Ability:\s*/i,"").trim();
        else if(/^Gender:\s*/i.test(line)){
          var importedGender=line.replace(/^Gender:\s*/i,"").trim().toUpperCase();
          set.gender=importedGender==="M"?"Male":importedGender==="F"?"Female":set.gender;
        }
        else if(/^Level:\s*/i.test(line))set.level=Math.max(1,Math.min(100,Number(line.replace(/^Level:\s*/i,"").trim())||50));
        else if(/^Tera Type:\s*/i.test(line))set.teraType=line.replace(/^Tera Type:\s*/i,"").trim();
        else if(/^EVs:\s*/i.test(line))set.evs=parseShowdownSpread(line.replace(/^EVs:\s*/i,""),set.evs);
        else if(/^IVs:\s*/i.test(line))set.ivs=parseShowdownSpread(line.replace(/^IVs:\s*/i,""),set.ivs);
        else if(/^Gigantamax:\s*Yes/i.test(line))set.gigantamax=true;
        else if(/ Nature$/i.test(line))set.nature=line.replace(/ Nature$/i,"").trim();
        else if(/^[-–]\s+/.test(line)&&set.moves.length<4)set.moves.push(line.replace(/^[-–]\s+/,"").trim());
      });
      return set.species?set:null;
    }).filter(Boolean);
  }

  var showdownNatureEffects={
    adamant:["attack","specialAttack"],bashful:["",""],bold:["defense","attack"],brave:["attack","speed"],
    calm:["specialDefense","attack"],careful:["specialDefense","specialAttack"],docile:["",""],gentle:["specialDefense","defense"],
    hardy:["",""],hasty:["speed","defense"],impish:["defense","specialAttack"],jolly:["speed","specialAttack"],
    lax:["defense","specialDefense"],lonely:["attack","defense"],mild:["specialAttack","defense"],modest:["specialAttack","attack"],
    naive:["speed","specialDefense"],naughty:["attack","specialDefense"],quiet:["specialAttack","speed"],quirky:["",""],
    rash:["specialAttack","specialDefense"],relaxed:["defense","speed"],sassy:["specialDefense","speed"],serious:["",""],
    timid:["speed","attack"]
  };

  function showdownNatureMultiplier(nature,key){
    var effect=showdownNatureEffects[String(nature||"").toLowerCase()];
    if(!effect)return 1;
    if(effect[0]===key)return 1.1;
    if(effect[1]===key)return .9;
    return 1;
  }

  function calculateShowdownStats(pokemonData,set){
    var base={};
    (pokemonData.stats||[]).forEach(function(row){
      var key={"hp":"hp","attack":"attack","defense":"defense","special-attack":"specialAttack","special-defense":"specialDefense","speed":"speed"}[row.stat&&row.stat.name];
      if(key)base[key]=Number(row.base_stat)||0;
    });
    var out=emptyStats(),level=set.level||50;
    statKeys.forEach(function(key){
      if(base[key]===undefined)return;
      var iv=Number(set.ivs[key]);if(!Number.isFinite(iv))iv=31;
      var ev=Number(set.evs[key])||0;
      if(key==="hp"){
        out[key]=base[key]===1?1:Math.floor(((2*base[key]+iv+Math.floor(ev/4))*level)/100)+level+10;
      }else{
        var raw=Math.floor(((2*base[key]+iv+Math.floor(ev/4))*level)/100)+5;
        out[key]=Math.floor(raw*showdownNatureMultiplier(set.nature,key));
      }
    });
    return out;
  }

  function showdownFormMatchScore(requested,varietySlug){
    if(varietySlug===requested)return 100;
    if(varietySlug.indexOf(requested+"-")===0)return 90;

    var simplified=varietySlug;
    ["-mask","-form","-mode","-style","-cloak"].forEach(function(word){
      if(simplified.endsWith(word))simplified=simplified.slice(0,-word.length);
    });
    if(simplified===requested)return 85;

    var requestedParts=requested.split("-");
    var varietyParts=varietySlug.split("-");
    return requestedParts.filter(function(part){return varietyParts.indexOf(part)!==-1}).length;
  }

  async function pokemonDataForShowdown(species){
    var requested=showdownSlug(species);
    if(!requested)throw new Error("Missing species");

    var res=await fetch(API+"/pokemon/"+encodeURIComponent(requested));
    if(res.ok)return res.json();

    var parts=requested.split("-");
    for(var cut=parts.length;cut>=1;cut--){
      var speciesSlug=parts.slice(0,cut).join("-");
      var speciesRes=await fetch(API+"/pokemon-species/"+encodeURIComponent(speciesSlug));
      if(!speciesRes.ok)continue;

      var speciesData=await speciesRes.json();
      var varieties=(speciesData.varieties||[]).slice();
      if(!varieties.length)continue;

      varieties.sort(function(a,b){
        var aScore=showdownFormMatchScore(requested,a.pokemon.name);
        var bScore=showdownFormMatchScore(requested,b.pokemon.name);
        return bScore-aScore||Number(b.is_default)-Number(a.is_default);
      });

      res=await fetch(API+"/pokemon/"+encodeURIComponent(varieties[0].pokemon.name));
      if(res.ok)return res.json();
    }

    throw new Error("Pokémon not found");
  }

  async function hydrateShowdownSet(set){
    var mon=blankMon();
    mon.name=set.species;
    mon.slug=showdownSlug(set.species);
    mon.ability=set.ability;
    mon.item=set.item;
    mon.gender=set.gender;
    mon.level=set.level||50;
    mon.alignment=set.nature;
    mon.teraType=set.teraType;
    mon.gigantamax=!!set.gigantamax;
    mon.evs=set.evs||null;
    mon.ivs=set.ivs||null;
    mon.moves=set.moves.slice(0,4);
    while(mon.moves.length<4)mon.moves.push("");

    try{
      var pokemonData=await pokemonDataForShowdown(set.species);
      var speciesSlug=(pokemonData.species&&pokemonData.species.name)||showdownSlug(set.species);
      var speciesRes=await fetch(API+"/pokemon-species/"+encodeURIComponent(speciesSlug));
      var speciesData=speciesRes.ok?await speciesRes.json():null;
      var forms=speciesData?(speciesData.varieties||[]).map(function(v){return {slug:v.pokemon.name,isDefault:!!v.is_default}}):[];
      var currentForm=forms.filter(function(v){return v.slug===pokemonData.name})[0]||{slug:pokemonData.name,isDefault:pokemonData.name===speciesSlug};

      mon.speciesSlug=speciesSlug;
      mon.slug=pokemonData.name;
      mon.name=prettyName(speciesSlug);
      mon.form=formLabel(speciesSlug,pokemonData.name,currentForm.isDefault);
      mon.availableForms=forms;
      mon.image=(pokemonData.sprites&&pokemonData.sprites.other&&pokemonData.sprites.other.home&&pokemonData.sprites.other.home.front_default)||
        (pokemonData.sprites&&pokemonData.sprites.other&&pokemonData.sprites.other["official-artwork"]&&pokemonData.sprites.other["official-artwork"].front_default)||
        (pokemonData.sprites&&pokemonData.sprites.front_default)||"";
      mon.types=(pokemonData.types||[]).map(function(t){return prettyName(t.type.name)});
      mon.availableAbilities=(pokemonData.abilities||[]).map(function(a){return a.ability.name});
      mon.availableMoves=(pokemonData.moves||[]).map(function(m){return m.move.name});
      if(state.game!=="champions")mon.stats=calculateShowdownStats(pokemonData,set);
    }catch(e){
      mon.name=set.species;
    }

    if(set.nature){
      var natureMeta=await getNatureMeta(set.nature);
      mon.alignmentUp=natureMeta.up||"";
      mon.alignmentDown=natureMeta.down||"";
    }
    if(set.item){
      var itemMeta=await getItemMeta(set.item);
      mon.itemImage=itemMeta.image||"";
    }
    await Promise.all(mon.moves.map(async function(move,index){
      if(!move)return;
      var meta=await getMoveMeta(move);
      mon.moveTypes[index]=meta.type||"";
      mon.moveClasses[index]=meta.damageClass||"";
    }));
    return mon;
  }

  function openShowdownImport(){
    var dialog=$("#showdownDialog");
    $("#showdownImportStatus").textContent="";
    $("#showdownGameNote").textContent=state.game==="champions"
      ?"Importing replaces the current six Pokémon. Showdown EVs/IVs are not mapped to Champions Stat Points, so those still need to be entered separately."
      :"Importing replaces the current six Pokémon. EVs and IVs are used to calculate final stats with standard main-series formulas.";
    if(dialog&&typeof dialog.showModal==="function"){
      dialog.showModal();
      if(shouldAutoFocus())setTimeout(function(){$("#showdownText").focus()},60);
    }
  }

  function closeShowdownImport(){
    var dialog=$("#showdownDialog");
    if(dialog&&dialog.open)dialog.close();
  }

  async function importShowdownTeam(event){
    event.preventDefault();
    var sets=parseShowdownTeam($("#showdownText").value);
    var status=$("#showdownImportStatus");
    if(!sets.length){
      status.textContent="No valid Showdown sets were found.";
      status.classList.add("is-error");
      return;
    }
    if(state.team.some(function(mon){return mon&&mon.name})&&!confirm("Replace the current team with the imported Showdown team?"))return;

    var button=$("#importShowdownButton");
    button.disabled=true;button.textContent="Importing…";
    status.classList.remove("is-error");
    status.textContent="Importing "+sets.length+" Pokémon…";
    try{
      var mons=await Promise.all(sets.map(hydrateShowdownSet));
      state.team=mons.slice(0,6);
      while(state.team.length<6)state.team.push(null);
      markDirty();
      renderTeam();
      closeShowdownImport();
      showToast(mons.length+" Pokémon imported from Showdown");
      $("#showdownText").value="";
    }catch(err){
      console.error("Showdown import failed",err);
      status.textContent="Could not import this team. Check the pasted Showdown export and try again.";
      status.classList.add("is-error");
    }finally{
      button.disabled=false;button.textContent="Import team";
    }
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
    $("#openShowdownImport").addEventListener("click",openShowdownImport);
    $("#showdownImportForm").addEventListener("submit",importShowdownTeam);
    $("#closeShowdownDialog").addEventListener("click",closeShowdownImport);
    $("#cancelShowdownImport").addEventListener("click",closeShowdownImport);
    $("#showdownDialog").addEventListener("click",function(e){if(e.target===this)closeShowdownImport()});
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
    $("#goLeague").addEventListener("change",function(){
      var value=this.value;
      if(value==="great")$("#goCpCap").value="1500";
      if(value==="ultra")$("#goCpCap").value="2500";
      if(value==="master")$("#goCpCap").value="";
      $("#goCpCap").disabled=value==="master";
      syncMeta(true);
      renderTeam();
    });
    $("#goCpCap").addEventListener("input",function(){syncMeta(true)});
    ["playerName","trainerName","playerId","yearOfBirth"].forEach(function(id){$("#"+id).addEventListener("change",function(){syncMeta(true)})});
    $$("[data-sheet-mode]").forEach(function(b){b.addEventListener("click",function(){if(state.sheetMode!==b.dataset.sheetMode){state.sheetMode=b.dataset.sheetMode;markDirty()}renderPreview()})});
    $("#printButton").addEventListener("click",function(){printTeamSheet()});
    $("#showdownExportButton").addEventListener("click",exportShowdown);
    $("#shareButton").addEventListener("click",shareTeam);
    $("#retryStatsButton").addEventListener("click",function(){loadStats(true)});
    document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!$("#editorBackdrop").hidden)closeEditor()});
    window.addEventListener("beforeunload",function(e){
      if(state.activeBuild&&state.dirty){e.preventDefault();e.returnValue=""}
    });
  }

  function compactMonForExport(mon){
    if(!mon)return null;
    var copy=JSON.parse(JSON.stringify(mon));
    delete copy.availableMoves;
    delete copy.availableAbilities;
    delete copy.availableForms;
    return copy;
  }

  window.VCGApp={
    exportTeam:function(){
      syncMeta(false);
      return JSON.parse(JSON.stringify({
        game:state.game,
        sheetMode:state.sheetMode,
        meta:state.meta,
        team:state.team.map(compactMonForExport)
      }));
    },
    importTeam:function(payload){
      if(!payload||!Array.isArray(payload.team)||!gameConfig[payload.game])return false;
      if(state.activeBuild&&!leaveBuild())return false;
      state.game=payload.game;
      state.sheetMode=payload.sheetMode==="open"?"open":"full";
      state.activeBuild=true;
      state.dirty=false;
      state.meta=Object.assign({playerName:"",trainerName:"",playerId:"",yearOfBirth:"",goLeague:"great",goCpCap:"1500"},payload.meta||{});
      state.team=normaliseTeamLength(payload.team,payload.game);
      document.body.dataset.game=state.game;
      $("#builderTitle").textContent=gameConfig[state.game].name;
      $("#builderGameArt").style.backgroundImage="url('"+gameConfig[state.game].art+"')";
      configureGameUi();
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
    isDirty:function(){return state.dirty},
    deleteAccountCleanup:function(){
      try{
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        localStorage.removeItem(LOCAL_SAVE_KEY);
      }catch(e){}
      state.game=null;
      state.sheetMode="full";
      state.editingIndex=null;
      state.activeBuild=false;
      state.dirty=false;
      state.meta={playerName:"",trainerName:"",playerId:"",yearOfBirth:"",goLeague:"great",goCpCap:"1500"};
      state.team=blankTeam();
      populateMeta();
      renderTeam();
      document.dispatchEvent(new CustomEvent("vcg:buildreset"));
    }
  };

  function init(){
    loadState();renderStatInputs();populateMeta();wireEvents();
    configureGameUi();
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
      var currentTarget=current&&current.id==="builderView"?"team":current&&current.id==="previewView"?"preview":current&&current.id==="teamsView"?"teams":current&&current.id==="statsView"?"stats":current&&current.id==="profileView"?"profile":"home";
      if(!navigate(requestedTarget,{skipHistory:true,instant:true})){
        history.pushState({target:currentTarget},"",routePaths[currentTarget]||"/");
      }
    });
    if("serviceWorker" in navigator)window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})});
  }

  document.addEventListener("DOMContentLoaded",init);
})();