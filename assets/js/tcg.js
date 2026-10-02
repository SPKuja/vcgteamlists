(function(){
  "use strict";

  var API="https://api.tcgdex.net/v2/en";
  var STORAGE_KEY="vcg-tcg-deck-v1";
  var state={name:"",cards:[]};
  var searchTimer=null;
  var searchAbort=null;
  var setMetaCache={};
  var setCodeCache={};
  var previewCard=null;
  var previewScrollY=0;
  var accountUser=null;
  var validationTimer=null;
  var validationGeneration=0;
  var validationState={checking:false,metadataReady:false,aceReady:false,aceError:false,reprints:{}};
  var reprintCache={};
  var aceSpecIds=null;
  var aceSpecPromise=null;
  var lastValidation={status:"building",blockers:[],warnings:[],checkedAt:""};

  function $(s,root){return (root||document).querySelector(s)}
  function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}
  function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]})}
  function imageUrl(base,quality,extension){
    if(!base)return "";
    return String(base).replace(/\/$/,"")+"/"+(quality||"low")+"."+(extension||"webp");
  }
  function cardImageHtml(base,alt,quality){
    if(!base)return '<div class="tcg-image-unavailable" aria-label="Card image unavailable"><span>Image unavailable</span></div>';
    var preferred=quality==="high"?"high":"low";
    return '<img class="tcg-card-image" loading="lazy" src="'+esc(imageUrl(base,preferred,"webp"))+'" data-tcg-image-base="'+esc(base)+'" data-tcg-image-quality="'+preferred+'" data-tcg-image-step="0" alt="'+esc(alt||"")+'">';
  }
  function handleCardImageError(img){
    var base=img&&img.dataset?img.dataset.tcgImageBase:"";
    if(!base)return;
    var step=Number(img.dataset.tcgImageStep||0)+1;
    var preferred=img.dataset.tcgImageQuality==="high"?"high":"low";
    var fallbacks=preferred==="high"
      ? [imageUrl(base,"high","png"),imageUrl(base,"low","webp"),imageUrl(base,"low","png")]
      : [imageUrl(base,"low","png"),imageUrl(base,"high","webp"),imageUrl(base,"high","png")];
    if(step<=fallbacks.length){
      img.dataset.tcgImageStep=String(step);
      img.src=fallbacks[step-1];
      return;
    }
    var placeholder=document.createElement("div");
    placeholder.className="tcg-image-unavailable";
    placeholder.setAttribute("aria-label","Card image unavailable");
    placeholder.innerHTML="<span>Image unavailable</span>";
    img.replaceWith(placeholder);
  }
  function normaliseCard(card){
    return {
      id:String(card.id||""),
      name:String(card.name||"Unknown card"),
      category:String(card.category||"Other"),
      energyType:String(card.energyType||""),
      trainerType:String(card.trainerType||""),
      stage:String(card.stage||""),
      rarity:String(card.rarity||""),
      setId:String(card.set&&card.set.id||card.setId||card._setId||""),
      setName:String(card._setName||card.set&&card.set.name||card.setName||""),
      setCode:String(card._setCode||card.setCode||""),
      setOfficialCount:Number(card._setOfficialCount||card.setOfficialCount||0)||0,
      setReleaseDate:String(card._setReleaseDate||card.setReleaseDate||""),
      localId:String(card.localId==null?"":card.localId),
      image:String(card.image||""),
      regulationMark:String(card.regulationMark||""),
      legal:card.legal&&typeof card.legal==="object"?card.legal:{},
      qty:Math.max(1,Number(card.qty)||1)
    };
  }
  function load(){
    try{
      var saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
      if(saved&&typeof saved==="object"){
        state.name=String(saved.name||"");
        state.cards=Array.isArray(saved.cards)?saved.cards.map(normaliseCard).filter(function(card){return card.id}):[];
      }
    }catch(e){}
  }
  function save(){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}catch(e){}
  }
  function emit(name,detail){
    document.dispatchEvent(new CustomEvent(name,{detail:detail||{}}));
  }
  function exportDeck(player){
    var person=player||accountUser||{};
    return {
      schemaVersion:1,
      kind:"tcg",
      format:"standard",
      deckName:state.name||"",
      player:{
        playerName:String(person.playerName||""),
        playerId:String(person.playerId||""),
        yearOfBirth:person.yearOfBirth==null?null:Number(person.yearOfBirth)
      },
      cards:state.cards.map(function(card){return Object.assign({},card)}),
      totals:{
        total:total(),
        pokemon:categoryCount("Pokemon"),
        trainer:categoryCount("Trainer"),
        energy:categoryCount("Energy")
      },
      validation:{
        status:lastValidation.status,
        blockers:lastValidation.blockers.slice(),
        warnings:lastValidation.warnings.slice(),
        checkedAt:lastValidation.checkedAt||""
      }
    };
  }
  function importDeck(payload,name){
    if(!payload||!Array.isArray(payload.cards))return false;
    state.name=String(name||payload.deckName||"");
    state.cards=payload.cards.map(normaliseCard).filter(function(card){return card.id&&card.qty>0});
    save();
    var input=$("#tcgDeckName");if(input)input.value=state.name;
    renderDeck();
    if(window.VCGApp&&window.VCGApp.navigate)window.VCGApp.navigate("deck");
    return true;
  }
  function setDeckName(name){
    state.name=String(name||"");
    var input=$("#tcgDeckName");if(input)input.value=state.name;
    save();
  }
  function markDirty(){emit("vcg:deckdirty")}
  function total(){
    return state.cards.reduce(function(sum,card){return sum+(Number(card.qty)||0)},0);
  }
  function isBasicEnergy(card){
    if(!card||card.category!=="Energy")return false;
    var energyType=String(card.energyType||"").trim().toLowerCase();
    if(energyType==="basic")return true;
    if(energyType==="special")return false;

    // Older/incomplete records may omit energyType. Only recognised Basic
    // Energy names are exempt from the four-copy rule.
    var name=String(card.name||"").trim().toLowerCase().replace(/^basic\s+/,"");
    return /^(grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy) energy$/.test(name);
  }
  function categoryCount(category){
    return state.cards.reduce(function(sum,card){return sum+(card.category===category?(Number(card.qty)||0):0)},0);
  }
  function nameTotals(){
    var totals={};
    state.cards.forEach(function(card){
      if(isBasicEnergy(card))return;
      var key=card.name.trim().toLowerCase();
      if(!key)return;
      if(!totals[key])totals[key]={name:card.name,count:0};
      totals[key].count+=Number(card.qty)||0;
    });
    return Object.keys(totals).map(function(key){return totals[key]});
  }
  function isAceSpec(card){
    if(!card)return false;
    if(/ace\s*spec/i.test(String(card.rarity||"")))return true;
    return !!(aceSpecIds&&aceSpecIds.has(String(card.id||"")));
  }
  function hasKnownBasicPokemon(){
    return state.cards.some(function(card){
      return card.category==="Pokemon"&&String(card.stage||"").trim().toLowerCase()==="basic";
    });
  }
  function pokemonStageMetadataComplete(){
    return state.cards.filter(function(card){return card.category==="Pokemon"}).every(function(card){
      return !!String(card.stage||"").trim();
    });
  }
  function standardState(card){
    if(card&&card.legal&&card.legal.standard===true)return "legal";
    if(card&&card.legal&&card.legal.standard===false)return "rotated";
    return "unknown";
  }
  function validationItem(type,title,text){
    return {type:type,title:title,text:text};
  }
  function buildValidationSummary(){
    var items=[],blockers=[],warnings=[],checking=false;
    var count=total();

    if(count===60){
      items.push(validationItem("ok","Deck size","Exactly 60 cards."));
    }else if(count<60){
      var missing=60-count;
      var sizeText="Add "+missing+" more card"+(missing===1?"":"s")+" to reach 60.";
      items.push(validationItem("warn","Deck size",sizeText));
      blockers.push(sizeText);
    }else{
      var excess=count-60;
      var excessText="Remove "+excess+" card"+(excess===1?"":"s")+" — constructed decks must contain exactly 60 cards.";
      items.push(validationItem("error","Deck size",excessText));
      blockers.push(excessText);
    }

    var over=nameTotals().filter(function(item){return item.count>4});
    if(over.length){
      var copyText="Four-copy limit exceeded: "+over.map(function(item){return item.name+" ×"+item.count}).join(", ")+". Basic Energy is exempt.";
      items.push(validationItem("error","Copy limit",copyText));
      blockers.push(copyText);
    }else{
      items.push(validationItem("ok","Copy limit","No four-copy rule conflicts detected."));
    }

    if(hasKnownBasicPokemon()){
      items.push(validationItem("ok","Basic Pokémon","At least one Basic Pokémon is included."));
    }else if(!pokemonStageMetadataComplete()&&!validationState.metadataReady&&state.cards.some(function(card){return card.category==="Pokemon"})){
      checking=true;
      items.push(validationItem("checking","Basic Pokémon","Checking Pokémon stages…"));
    }else{
      var basicText="Add at least one Basic Pokémon.";
      items.push(validationItem("error","Basic Pokémon",basicText));
      blockers.push(basicText);
    }

    var aceCards=state.cards.filter(isAceSpec);
    var aceCount=aceCards.reduce(function(sum,card){return sum+(Number(card.qty)||0)},0);
    if(validationState.aceError){
      var aceWarn="ACE SPEC metadata could not be refreshed; review the deck manually if it contains an ACE SPEC card.";
      items.push(validationItem("warn","ACE SPEC",aceWarn));
      warnings.push(aceWarn);
    }else if(!validationState.aceReady){
      checking=true;
      items.push(validationItem("checking","ACE SPEC","Checking ACE SPEC restrictions…"));
    }else if(aceCount>1){
      var aceNames=aceCards.map(function(card){return card.name+" ×"+card.qty}).join(", ");
      var aceText="Only one ACE SPEC card total is allowed. Current deck: "+aceNames+".";
      items.push(validationItem("error","ACE SPEC",aceText));
      blockers.push(aceText);
    }else{
      items.push(validationItem("ok","ACE SPEC",aceCount===1?"One ACE SPEC card — limit satisfied.":"No ACE SPEC conflict."));
    }

    var rotatedByName={},unknownByName={};
    state.cards.forEach(function(card){
      var status=standardState(card);
      var key=String(card.name||"").trim().toLowerCase();
      if(!key)return;
      if(status==="rotated"&&!rotatedByName[key])rotatedByName[key]=card;
      if(status==="unknown"&&!unknownByName[key])unknownByName[key]=card;
    });

    var illegal=[],reprints=[],unverified=[];
    Object.keys(rotatedByName).forEach(function(key){
      var card=rotatedByName[key];
      var resolution=validationState.reprints[key];
      if(resolution==="reprint")reprints.push(card);
      else if(resolution==="illegal")illegal.push(card);
      else if(resolution==="error")unverified.push(card);
      else checking=true;
    });
    Object.keys(unknownByName).forEach(function(key){unverified.push(unknownByName[key])});

    if(illegal.length){
      var illegalText="Not Standard legal: "+illegal.map(function(card){
        return card.name+(card.regulationMark?" (Reg. "+card.regulationMark+")":"");
      }).join(", ")+". No current same-name legal reprint was found.";
      items.push(validationItem("error","Standard legality",illegalText));
      blockers.push(illegalText);
    }
    if(reprints.length){
      var reprintText="Older printing selected: "+reprints.map(function(card){return card.name}).join(", ")+". A same-name Standard-legal reprint exists; verify current wording and any errata.";
      items.push(validationItem("warn","Standard reprint",reprintText));
      warnings.push(reprintText);
    }
    if(unverified.length){
      var unverifiedNames=[];
      unverified.forEach(function(card){if(unverifiedNames.indexOf(card.name)===-1)unverifiedNames.push(card.name)});
      var verifyText="Could not fully verify Standard legality for "+unverifiedNames.join(", ")+".";
      if(validationState.metadataReady){
        items.push(validationItem("warn","Standard legality",verifyText));
        warnings.push(verifyText);
      }else{
        checking=true;
        items.push(validationItem("checking","Standard legality","Checking "+unverifiedNames.join(", ")+"…"));
      }
    }
    if(!illegal.length&&!reprints.length&&!unverified.length){
      items.push(validationItem("ok","Standard legality","All selected printings are marked Standard legal."));
    }

    var status="ready",title="Tournament Ready",copy="All automatic deck checks passed.";
    if(blockers.length){
      status=count===60?"blocked":"building";
      title=count===60?"Needs fixes":"Building";
      copy=blockers.length+" blocker"+(blockers.length===1?"":"s")+" before this deck is tournament ready.";
    }else if(checking){
      status="checking";title="Checking deck";copy="Finishing legality and card-rule checks…";
    }else if(warnings.length){
      status="review";title="Review needed";copy=warnings.length+" warning"+(warnings.length===1?"":"s")+" to review before submission.";
    }

    return {status:status,title:title,copy:copy,items:items,blockers:blockers,warnings:warnings};
  }
  function renderValidation(){
    var target=$("#tcgValidation");if(!target)return;
    var summary=buildValidationSummary();
    lastValidation={
      status:summary.status,
      blockers:summary.blockers.slice(),
      warnings:summary.warnings.slice(),
      checkedAt:new Date().toISOString()
    };

    var readiness=$("#tcgReadiness");
    if(readiness){
      readiness.className="tcg-readiness is-"+summary.status;
      $("#tcgReadinessTitle").textContent=summary.title;
      $("#tcgReadinessCopy").textContent=summary.copy;
      $("#tcgReadinessIcon").textContent=summary.status==="ready"?"✓":summary.status==="checking"?"…":summary.status==="review"?"!":"×";
    }

    target.innerHTML=summary.items.map(function(item){
      return '<div class="tcg-validation-item '+item.type+'"><strong>'+esc(item.title)+'</strong><span>'+esc(item.text)+'</span></div>';
    }).join("");

    var listStatus=$("#tcgListReadiness");
    if(listStatus){
      listStatus.className="tcg-list-readiness is-"+summary.status;
      listStatus.textContent=summary.title+" · "+summary.copy;
    }
  }
  async function loadAceSpecIndex(){
    if(aceSpecIds)return aceSpecIds;
    if(aceSpecPromise)return aceSpecPromise;
    aceSpecPromise=fetch(API+"/cards?rarity="+encodeURIComponent("ACE SPEC Rare"),{cache:"default"})
      .then(function(response){if(!response.ok)throw new Error("ACE SPEC index failed");return response.json()})
      .then(function(cards){
        aceSpecIds=new Set((Array.isArray(cards)?cards:[]).map(function(card){return String(card.id||"")}).filter(Boolean));
        validationState.aceReady=true;
        validationState.aceError=false;
        return aceSpecIds;
      })
      .catch(function(){
        aceSpecIds=new Set();
        validationState.aceReady=true;
        validationState.aceError=true;
        return aceSpecIds;
      });
    return aceSpecPromise;
  }
  async function hydrateValidationMetadata(){
    var targets=state.cards.filter(function(card){
      var missingStage=card.category==="Pokemon"&&!String(card.stage||"").trim();
      var missingLegal=!(card.legal&&Object.prototype.hasOwnProperty.call(card.legal,"standard"));
      return missingStage||missingLegal;
    });
    if(!targets.length)return;
    await Promise.all(targets.map(async function(card){
      try{
        var response=await fetch(API+"/cards/"+encodeURIComponent(card.id),{cache:"default"});
        if(!response.ok)return;
        var full=await response.json();
        if(full.stage)card.stage=String(full.stage);
        if(full.rarity)card.rarity=String(full.rarity);
        if(full.legal&&typeof full.legal==="object")card.legal=full.legal;
        if(full.regulationMark&&!card.regulationMark)card.regulationMark=String(full.regulationMark);
      }catch(e){}
    }));
  }
  async function resolveStandardReprint(name){
    var key=String(name||"").trim().toLowerCase();
    if(!key)return "error";
    if(reprintCache[key])return reprintCache[key];
    reprintCache[key]=(async function(){
      try{
        var url=API+"/cards?name=eq:"+encodeURIComponent(name)+"&sort:field=releaseDate&sort:order=DESC&pagination:page=1&pagination:itemsPerPage=16";
        var response=await fetch(url,{cache:"default"});
        if(!response.ok)throw new Error("Reprint search failed");
        var briefs=await response.json();
        briefs=(Array.isArray(briefs)?briefs:[]).filter(function(card){
          return String(card.name||"").trim().toLowerCase()===key;
        }).slice(0,16);
        if(!briefs.length)return "illegal";
        var full=await Promise.all(briefs.map(async function(card){
          try{
            var result=await fetch(API+"/cards/"+encodeURIComponent(card.id),{cache:"default"});
            return result.ok?result.json():null;
          }catch(e){return null}
        }));
        return full.some(function(card){return card&&card.legal&&card.legal.standard===true})?"reprint":"illegal";
      }catch(e){
        return "error";
      }
    })();
    return reprintCache[key];
  }
  async function refreshValidationAsync(){
    var generation=++validationGeneration;
    validationState.checking=true;
    validationState.metadataReady=false;
    renderValidation();

    await Promise.all([loadAceSpecIndex(),hydrateValidationMetadata()]);
    if(generation!==validationGeneration)return;
    validationState.metadataReady=true;

    var rotatedNames={};
    state.cards.forEach(function(card){
      if(standardState(card)==="rotated"){
        var key=String(card.name||"").trim().toLowerCase();
        if(key)rotatedNames[key]=card.name;
      }
    });
    var keys=Object.keys(rotatedNames);
    var results=await Promise.all(keys.map(function(key){return resolveStandardReprint(rotatedNames[key])}));
    if(generation!==validationGeneration)return;

    validationState.reprints={};
    keys.forEach(function(key,index){validationState.reprints[key]=results[index]});
    validationState.checking=false;
    renderValidation();
    save();
  }
  function scheduleValidationRefresh(){
    clearTimeout(validationTimer);
    validationTimer=setTimeout(function(){
      refreshValidationAsync().catch(function(){
        validationState.checking=false;
        validationState.metadataReady=true;
        renderValidation();
      });
    },120);
  }

  function categoryCards(category){
    return state.cards.filter(function(card){return card.category===category}).sort(function(a,b){
      return a.name.localeCompare(b.name)||a.setName.localeCompare(b.setName)||a.localId.localeCompare(b.localId,undefined,{numeric:true});
    });
  }
  function deckCardHtml(card){
    var reference=card.localId?(card.setCode?card.setCode+" ":"")+card.localId:"";
    var meta=[reference,card.setName,card.regulationMark?"Reg. "+card.regulationMark:""].filter(Boolean).join(" · ");
    var flag=card.legal&&card.legal.standard===false?'<span class="tcg-standard-flag">CHECK</span>':"";
    return '<article class="tcg-deck-card" data-tcg-deck-card="'+esc(card.id)+'">'+
      cardImageHtml(card.image,card.name)+
      '<div class="tcg-deck-card-copy"><strong>'+esc(card.name)+flag+'</strong><small>'+esc(meta||card.category)+'</small></div>'+
      '<div class="tcg-qty">'+
        '<button type="button" data-tcg-dec="'+esc(card.id)+'" aria-label="Remove one '+esc(card.name)+'">−</button>'+
        '<strong>'+esc(card.qty)+'</strong>'+
        '<button type="button" data-tcg-inc="'+esc(card.id)+'" aria-label="Add one '+esc(card.name)+'">+</button>'+
        '<button type="button" class="tcg-remove" data-tcg-remove="'+esc(card.id)+'" aria-label="Remove '+esc(card.name)+' from deck">×</button>'+
      '</div>'+
    '</article>';
  }
  function renderDeck(){
    var count=total();
    if($("#tcgDeckTotal"))$("#tcgDeckTotal").textContent=count;
    if($("#tcgPokemonCount"))$("#tcgPokemonCount").textContent=categoryCount("Pokemon");
    if($("#tcgTrainerCount"))$("#tcgTrainerCount").textContent=categoryCount("Trainer");
    if($("#tcgEnergyCount"))$("#tcgEnergyCount").textContent=categoryCount("Energy");
    var groups=$("#tcgDeckGroups");
    if(groups){
      var defs=[{key:"Pokemon",label:"Pokémon"},{key:"Trainer",label:"Trainers"},{key:"Energy",label:"Energy"}];
      groups.innerHTML=defs.map(function(def){
        var cards=categoryCards(def.key);
        var qty=cards.reduce(function(sum,card){return sum+card.qty},0);
        return '<section class="tcg-deck-group"><h3>'+def.label+' <span>'+qty+' card'+(qty===1?"":"s")+'</span></h3>'+
          '<div class="tcg-deck-list">'+(cards.length?cards.map(deckCardHtml).join(""):'<div class="tcg-deck-empty">No '+def.label.toLowerCase()+' added yet.</div>')+'</div></section>';
      }).join("");
    }
    renderValidation();
    save();
    scheduleValidationRefresh();
  }
  function setStatus(message){
    var el=$("#tcgSearchStatus");if(el)el.textContent=message;
  }
  function normaliseSetCode(value){
    return String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
  }
  function comparableCollector(value){
    var raw=String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
    return raw.replace(/^([A-Z]*?)0+(?=\d)/,"$1");
  }
  function collectorVariants(value){
    var raw=String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
    var out=[raw];
    if(/^\d+$/.test(raw)){
      var number=String(Number(raw));
      out.push(number);
      if(number.length<=2)out.push(number.padStart(2,"0"));
      if(number.length<=3)out.push(number.padStart(3,"0"));
    }
    return out.filter(function(item,index){return item&&out.indexOf(item)===index});
  }
  function parseCardReference(query){
    var raw=String(query||"").trim().toUpperCase().replace(/[-_/]+/g," ").replace(/\s+/g," ");
    var spaced=raw.match(/^([A-Z0-9]{2,8})\s+([A-Z]*\d+[A-Z]*)$/);
    if(spaced)return {code:normaliseSetCode(spaced[1]),localId:spaced[2]};
    var compact=raw.replace(/\s/g,"");
    var joined=compact.match(/^([A-Z]{2,8}?)(\d+[A-Z]?)$/);
    return joined?{code:normaliseSetCode(joined[1]),localId:joined[2]}:null;
  }
  function cardSetId(card){
    if(card&&card.set&&card.set.id)return String(card.set.id);
    if(card&&card.setId)return String(card.setId);
    if(card&&card._setId)return String(card._setId);
    var id=String(card&&card.id||"");
    var local=String(card&&card.localId||"");
    var suffix="-"+local;
    if(local&&id.toUpperCase().endsWith(suffix.toUpperCase()))return id.slice(0,id.length-suffix.length);
    var split=id.lastIndexOf("-");
    return split>0?id.slice(0,split):"";
  }
  async function getSetMeta(setId,signal){
    if(setMetaCache[setId])return setMetaCache[setId];
    var response=await fetch(API+"/sets/"+encodeURIComponent(setId),{signal:signal,cache:"default"});
    if(!response.ok)return null;
    var data=await response.json();
    setMetaCache[setId]=data;
    return data;
  }
  function officialSetCode(set){
    if(!set)return "";
    return String(
      set.abbreviation&&set.abbreviation.official||
      set.abbreviations&&set.abbreviations.official||
      set.tcgOnline||
      ""
    ).toUpperCase();
  }
  function decorateCardWithSet(card,set){
    if(!card)return card;
    var setId=set&&set.id||cardSetId(card);
    card._setId=String(setId||"");
    card._setName=String(set&&set.name||card.set&&card.set.name||"");
    card._setCode=officialSetCode(set);
    card._setOfficialCount=Number(set&&set.cardCount&&set.cardCount.official||0)||0;
    card._setReleaseDate=String(set&&set.releaseDate||"");
    return card;
  }
  async function enrichCards(cards,signal){
    cards=Array.isArray(cards)?cards:[];
    var ids=[];
    cards.forEach(function(card){
      var id=cardSetId(card);
      if(id&&ids.indexOf(id)===-1)ids.push(id);
    });
    var metas=await Promise.all(ids.map(function(id){return getSetMeta(id,signal)}));
    var byId={};
    metas.forEach(function(set,index){if(set)byId[ids[index]]=set});
    return cards.map(function(card){return decorateCardWithSet(card,byId[cardSetId(card)])});
  }
  function cardReferenceText(card){
    var code=String(card._setCode||card.setCode||"");
    var local=String(card.localId||"");
    var total=Number(card._setOfficialCount||card.setOfficialCount||0)||0;
    var setName=String(card._setName||card.setName||card.set&&card.set.name||"");
    var number=local+(total?"/"+total:"");
    var reference=[code,number].filter(Boolean).join(" ");
    return [reference,setName].filter(Boolean).join(" · ");
  }
  function formatCardText(value){
    return String(value==null?"":value).replace(/\{([^}]+)\}/g,"[$1]");
  }
  function energySymbolSvg(type){
    var key=String(type||"Colorless").trim();
    var lower=key.toLowerCase();
    var shapes={
      colorless:'<path d="M12 2.7l2.05 5.15 5.45-1.35-2.8 4.85 4.3 3.6-5.55.85.35 5.6-3.8-4.15-3.8 4.15.35-5.6-5.55-.85 4.3-3.6-2.8-4.85 5.45 1.35z"/>',
      grass:'<path d="M19.2 4.3C13.8 4.6 8.6 6.1 5.8 10.5c-2.4 3.8-.7 7.7 3.2 8.5 4.8 1 8.1-2.6 9.1-7.1.5-2.2.8-4.7 1.1-7.6zM7.4 17.3c2.2-3.4 5-6 8.7-8.2-2.8 2.8-5.1 5.8-6.8 9.2z"/>',
      fire:'<path d="M13.2 2.2c1 4-2.8 5.3-2.1 8.2.3 1.3 1.4 1.7 2.4.9 1.1-.8 1.4-2.3 1.2-3.8 2.7 2 4.4 4.5 4 7.5-.5 3.7-3.5 6.3-7.3 6.3-4.1 0-7.2-2.8-7.2-6.7 0-3.2 1.9-5.8 4.6-8.1-.2 2.2.2 3.9 1.5 4.7-.1-3.5 1.4-6.3 2.9-9z"/>',
      water:'<path d="M12 2.1s-6.7 7.3-6.7 12.3A6.7 6.7 0 0012 21.1a6.7 6.7 0 006.7-6.7C18.7 9.4 12 2.1 12 2.1zm-3 12.8c.5 1.7 1.7 2.8 3.8 3.3-2.8.8-5.2-1-5.3-3.5-.1-.8.1-1.6.5-2.4.1 1 .4 1.9 1 2.6z"/>',
      lightning:'<path d="M13.6 1.7L5.2 13h5.4l-1 9.3L18.8 10h-5.5z"/>',
      psychic:'<path d="M12 3a8.8 8.8 0 108.8 8.8h-3a5.8 5.8 0 11-1.7-4.1 4 4 0 10.1 5.8h-2.8a1.5 1.5 0 11.4-1.1H11a4.2 4.2 0 104.2-4.2v3h5.6A8.8 8.8 0 0012 3z"/>',
      fighting:'<path d="M4 9.2c0-1 .8-1.8 1.8-1.8h1V5.9c0-1 .8-1.8 1.8-1.8.7 0 1.3.4 1.6.9.3-.7 1-1.2 1.8-1.2.9 0 1.6.6 1.8 1.4.3-.5.9-.9 1.6-.9 1 0 1.8.8 1.8 1.8v4.1h.5c1.3 0 2.3 1 2.3 2.3v2.2c0 4.2-3.3 7.5-7.5 7.5h-1.1c-2.2 0-4.1-.9-5.5-2.4L3.4 17c-.7-.8-.7-2 .1-2.7.8-.7 2-.7 2.7.1l.7.8V11H5.8C4.8 11 4 10.2 4 9.2z"/>',
      darkness:'<path d="M15.7 2.8a9.4 9.4 0 100 18.4c-3.3-1.7-5.5-5.1-5.5-9.2s2.2-7.5 5.5-9.2zm1.4 5.1l.8 1.9 2.1.2-1.6 1.4.5 2-1.8-1.1-1.8 1.1.5-2-1.6-1.4 2.1-.2z"/>',
      metal:'<path d="M9.2 2.5h5.6l1 2.5 2.5-1 3 4.7-2 1.8.4 2.7 2.2 1.4-2.8 5-2.6-.8-1.8 2.2H9.1l-1.7-2.2-2.7.8-2.6-5 2.2-1.4.4-2.7-2-1.8 3-4.7 2.5 1 1-2.5zm2.8 5A4.5 4.5 0 1012 16.5 4.5 4.5 0 0012 7.5z"/>',
      fairy:'<path d="M12 2.2l1.8 5.5 5.7-.1-4.7 3.3 1.9 5.4-4.7-3.2-4.7 3.2 1.9-5.4-4.7-3.3 5.7.1L12 2.2zm0 13.2l1 2.5 2.7.1-2.1 1.7.7 2.6-2.3-1.5-2.3 1.5.7-2.6-2.1-1.7 2.7-.1z"/>',
      dragon:'<path d="M4.1 5.4c4.5-2.8 9.2-2.7 14.1.4l-4.5 1.4 4.9 3.2-5.2.5 3.7 4.6-5.1-1.4-1.7 6.1-2-5.6-4.8 2.2 2.7-5.1-4.8-.2 4.2-3.2z"/>'
    };
    if(!shapes[lower])lower="colorless";
    return '<span class="tcg-energy-symbol '+esc(lower)+'" title="'+esc(key)+' Energy" aria-label="'+esc(key)+' Energy">'+
      '<svg viewBox="0 0 24 24" aria-hidden="true">'+shapes[lower]+'</svg></span>';
  }
  function energyCostHtml(cost){
    if(!Array.isArray(cost)||!cost.length)return "";
    return '<span class="tcg-energy-cost">'+cost.map(energySymbolSvg).join("")+'</span>';
  }
  function renderPokemonInfo(card){
    var out=[];
    var facts=[];
    if(card.hp!=null)facts.push('<div><small>HP</small><strong>'+esc(card.hp)+'</strong></div>');
    if(Array.isArray(card.types)&&card.types.length)facts.push('<div><small>Type</small><strong>'+esc(card.types.join(" / "))+'</strong></div>');
    if(card.stage)facts.push('<div><small>Stage</small><strong>'+esc(card.stage.replace(/Stage(\d)/,"Stage $1"))+'</strong></div>');
    if(card.evolveFrom)facts.push('<div><small>Evolves from</small><strong>'+esc(card.evolveFrom)+'</strong></div>');
    if(facts.length)out.push('<div class="tcg-card-facts">'+facts.join("")+'</div>');

    if(Array.isArray(card.abilities)&&card.abilities.length){
      out.push('<section class="tcg-card-info-section"><h3>Abilities</h3>'+
        card.abilities.map(function(ability){
          return '<article class="tcg-card-effect"><div class="tcg-card-effect-head"><strong>'+esc(ability.name||"Ability")+'</strong><span>'+esc(ability.type||"Ability")+'</span></div>'+
            (ability.effect?'<p>'+esc(formatCardText(ability.effect))+'</p>':"")+'</article>';
        }).join("")+'</section>');
    }

    if(Array.isArray(card.attacks)&&card.attacks.length){
      out.push('<section class="tcg-card-info-section"><h3>Attacks</h3>'+
        card.attacks.map(function(attack){
          return '<article class="tcg-card-effect"><div class="tcg-card-effect-head">'+energyCostHtml(attack.cost)+'<strong>'+esc(attack.name||"Attack")+'</strong>'+
            (attack.damage!==undefined&&attack.damage!==null&&String(attack.damage)!==""?'<b class="tcg-attack-damage">'+esc(attack.damage)+'</b>':"")+'</div>'+
            (attack.effect?'<p>'+esc(formatCardText(attack.effect))+'</p>':"")+'</article>';
        }).join("")+'</section>');
    }

    var battle=[];
    if(Array.isArray(card.weaknesses)&&card.weaknesses.length)battle.push('<div><small>Weakness</small><strong class="tcg-type-value">'+card.weaknesses.map(function(item){return energySymbolSvg(item.type)+(item.value?'<span>'+esc(item.value)+'</span>':"")}).join("")+'</strong></div>');
    if(Array.isArray(card.resistances)&&card.resistances.length)battle.push('<div><small>Resistance</small><strong class="tcg-type-value">'+card.resistances.map(function(item){return energySymbolSvg(item.type)+(item.value?'<span>'+esc(item.value)+'</span>':"")}).join("")+'</strong></div>');
    if(card.retreat!==undefined&&card.retreat!==null){
      var retreatCount=Math.max(0,Number(card.retreat)||0);
      var retreatIcons=[];
      for(var r=0;r<retreatCount;r++)retreatIcons.push(energySymbolSvg("Colorless"));
      battle.push('<div><small>Retreat</small><strong class="tcg-type-value">'+(retreatIcons.length?retreatIcons.join(""):'<span>Free</span>')+'</strong></div>');
    }
    if(battle.length)out.push('<div class="tcg-card-facts compact">'+battle.join("")+'</div>');
    return out.join("");
  }
  function renderTrainerEnergyInfo(card){
    var out=[];
    if(card.effect){
      out.push('<section class="tcg-card-info-section"><h3>Card text</h3><article class="tcg-card-effect"><p>'+esc(formatCardText(card.effect))+'</p></article></section>');
    }
    if(card.description){
      out.push('<section class="tcg-card-info-section"><h3>Description</h3><article class="tcg-card-effect"><p>'+esc(formatCardText(card.description))+'</p></article></section>');
    }
    return out.join("");
  }
  function renderCardExtraInfo(card){
    var html=card.category==="Pokemon"?renderPokemonInfo(card):renderTrainerEnergyInfo(card);
    var meta=[];
    if(card.rarity)meta.push('<div><small>Rarity</small><strong>'+esc(card.rarity)+'</strong></div>');
    if(card.illustrator)meta.push('<div><small>Illustrator</small><strong>'+esc(card.illustrator)+'</strong></div>');
    if(card.regulationMark)meta.push('<div><small>Regulation</small><strong>'+esc(card.regulationMark)+'</strong></div>');
    if(meta.length)html+='<div class="tcg-card-facts compact meta">'+meta.join("")+'</div>';
    if(!html)html='<div class="tcg-card-info-empty">No additional card text is available for this printing.</div>';
    return html;
  }
  function setMatchesCode(set,code){
    if(!set)return false;
    var target=normaliseSetCode(code);
    var candidates=[
      set.id,
      set.tcgOnline,
      String(set.name||"").split(/\s+/)[0]
    ];
    if(set.abbreviation&&typeof set.abbreviation==="object"){
      Object.keys(set.abbreviation).forEach(function(key){
        candidates.push(set.abbreviation[key]);
      });
    }
    if(set.abbreviations&&typeof set.abbreviations==="object"){
      Object.keys(set.abbreviations).forEach(function(key){
        candidates.push(set.abbreviations[key]);
      });
    }
    candidates=candidates.map(normaliseSetCode).filter(Boolean);
    return candidates.indexOf(target)!==-1;
  }
  async function resolveSetIdByCode(code,signal){
    var key=normaliseSetCode(code);
    if(setCodeCache[key])return setCodeCache[key];

    var queries=[
      "abbreviation.official=eq:"+encodeURIComponent(key),
      "id=eq:"+encodeURIComponent(key.toLowerCase()),
      "tcgOnline=eq:"+encodeURIComponent(key)
    ];

    for(var i=0;i<queries.length;i++){
      var response=await fetch(API+"/sets?"+queries[i],{signal:signal,cache:"default"});
      if(!response.ok)continue;
      var sets=await response.json();
      if(Array.isArray(sets)&&sets.length){
        var exact=sets.filter(function(set){
          return normaliseSetCode(set.id)===key||normaliseSetCode(set.name)===key;
        })[0]||sets[0];
        if(exact&&exact.id){
          setCodeCache[key]=String(exact.id);
          return setCodeCache[key];
        }
      }
    }
    return "";
  }
  async function searchCardReference(reference,signal){
    var variants=collectorVariants(reference.localId);
    var setId=await resolveSetIdByCode(reference.code,signal);

    if(setId){
      for(var i=0;i<variants.length;i++){
        var response=await fetch(API+"/sets/"+encodeURIComponent(setId)+"/"+encodeURIComponent(variants[i]),{signal:signal,cache:"default"});
        if(!response.ok)continue;
        var card=await response.json();
        if(card&&comparableCollector(card.localId)===comparableCollector(reference.localId))return [card];
      }
    }

    // Final fallback for codes that are themselves TCGdex set IDs.
    for(var v=0;v<variants.length;v++){
      try{
        var direct=await fetch(API+"/cards/"+encodeURIComponent(reference.code.toLowerCase()+"-"+variants[v]),{signal:signal,cache:"default"});
        if(direct.ok){
          var directCard=await direct.json();
          if(comparableCollector(directCard.localId)===comparableCollector(reference.localId))return [directCard];
        }
      }catch(err){
        if(err&&err.name==="AbortError")throw err;
      }
    }
    return [];
  }
  function renderSearchResults(cards){
    var target=$("#tcgSearchResults");if(!target)return;
    if(!cards.length){
      target.innerHTML='<div class="tcg-search-empty">No matching cards found.</div>';
      return;
    }
    target.innerHTML=cards.map(function(card){
      var setYear=String(card._setReleaseDate||"").slice(0,4);
      return '<button type="button" class="tcg-search-result" data-tcg-card="'+esc(card.id)+'" aria-label="Preview '+esc(card.name)+'">'+
        cardImageHtml(card.image,card.name)+
        '<span class="tcg-search-result-copy"><strong>'+esc(card.name)+'</strong><small>'+esc(cardReferenceText(card))+'</small>'+
          (setYear?'<em>'+esc(setYear)+'</em>':"")+'</span>'+
        '<span class="tcg-search-preview-cue">View <b>›</b></span>'+
      '</button>';
    }).join("");
  }
  function sortByNewest(cards){
    return cards.sort(function(a,b){
      var dateCompare=String(b._setReleaseDate||"").localeCompare(String(a._setReleaseDate||""));
      if(dateCompare)return dateCompare;
      return String(a.localId||"").localeCompare(String(b.localId||""),undefined,{numeric:true});
    });
  }
  function sortSetCards(cards,setId){
    return cards.sort(function(a,b){
      var aSet=cardSetId(a)===setId?0:1;
      var bSet=cardSetId(b)===setId?0:1;
      if(aSet!==bSet)return aSet-bSet;
      if(aSet===0)return String(a.localId||"").localeCompare(String(b.localId||""),undefined,{numeric:true});
      return String(b._setReleaseDate||"").localeCompare(String(a._setReleaseDate||""));
    });
  }
  function mergeCards(primary,secondary){
    var out=[],seen={};
    (primary||[]).concat(secondary||[]).forEach(function(card){
      if(!card||!card.id||seen[card.id])return;
      seen[card.id]=true;out.push(card);
    });
    return out;
  }
  async function search(query){
    var q=String(query||"").trim();
    if(q.length<2){
      if(searchAbort)searchAbort.abort();
      var target=$("#tcgSearchResults");if(target)target.innerHTML="";
      setStatus("Type at least two characters to search.");
      return;
    }
    if(searchAbort)searchAbort.abort();
    searchAbort=new AbortController();
    setStatus("Searching TCGdex…");
    var target=$("#tcgSearchResults");if(target)target.innerHTML='<div class="tcg-search-empty">Searching…</div>';
    try{
      var reference=parseCardReference(q);
      var cards;
      if(reference){
        cards=await searchCardReference(reference,searchAbort.signal);
        cards=await enrichCards(cards,searchAbort.signal);
        renderSearchResults(cards);
        setStatus(cards.length
          ?"Found "+cards.length+" card"+(cards.length===1?"":"s")+" for "+reference.code+" "+reference.localId+"."
          :"No card found for "+reference.code+" "+reference.localId+".");
        return;
      }

      var nameUrl=API+"/cards?name="+encodeURIComponent(q)+"&pagination:page=1&pagination:itemsPerPage=24";
      var namePromise=fetch(nameUrl,{signal:searchAbort.signal,cache:"default"}).then(function(response){
        if(!response.ok)throw new Error("Card search failed");
        return response.json();
      }).then(function(found){return Array.isArray(found)?found:[]});

      var possibleCode=/^[A-Za-z0-9]{2,8}$/.test(q)?normaliseSetCode(q):"";
      var setIdPromise=possibleCode?resolveSetIdByCode(possibleCode,searchAbort.signal):Promise.resolve("");
      var pair=await Promise.all([namePromise,setIdPromise]);
      var nameCards=pair[0],setId=pair[1],setCards=[],matchedSet=null;

      if(setId){
        matchedSet=await getSetMeta(setId,searchAbort.signal);
        setCards=matchedSet&&Array.isArray(matchedSet.cards)?matchedSet.cards.slice():[];
      }

      cards=mergeCards(setCards,nameCards);
      cards=await enrichCards(cards,searchAbort.signal);
      cards=setId?sortSetCards(cards,setId):sortByNewest(cards);
      renderSearchResults(cards);

      if(setId&&matchedSet){
        setStatus("Showing "+cards.length+" result"+(cards.length===1?"":"s")+" for "+officialSetCode(matchedSet)+" · "+matchedSet.name+".");
      }else{
        setStatus(cards.length?"Showing "+cards.length+" matching printing"+(cards.length===1?"":"s")+" — newest first.":"No matching cards found.");
      }
    }catch(err){
      if(err&&err.name==="AbortError")return;
      setStatus("Card search is temporarily unavailable.");
      if(target)target.innerHTML='<div class="tcg-search-empty">Could not load cards. Try again.</div>';
    }
  }
  async function addCard(id,cardData,quantity){
    if(!id)return;
    setStatus("Adding card…");
    try{
      var amount=Math.max(1,Math.min(60,Number(quantity)||1));
      var full=cardData||null;
      if(!full){
        var response=await fetch(API+"/cards/"+encodeURIComponent(id),{cache:"default"});
        if(!response.ok)throw new Error("Card lookup failed");
        full=await response.json();
      }
      full=(await enrichCards([full]))[0]||full;
      var existing=state.cards.filter(function(card){return card.id===id})[0];
      if(existing)existing.qty=Math.min(60,existing.qty+amount);
      else{
        var normalised=normaliseCard(full);
        normalised.qty=amount;
        state.cards.push(normalised);
      }
      renderDeck();
      markDirty();
      setStatus(amount+" × "+(full.name||"Card")+" added to deck.");
    }catch(err){
      setStatus("Could not add that card. Try again.");
    }
  }
  function copiesOfName(name){
    var key=String(name||"").trim().toLowerCase();
    return state.cards.reduce(function(sum,card){
      return sum+(String(card.name||"").trim().toLowerCase()===key?(Number(card.qty)||0):0);
    },0);
  }
  function previewQuantityLimit(card){
    var deckSpace=Math.max(0,60-total());
    if(isBasicEnergy(card))return deckSpace;
    return Math.max(0,Math.min(deckSpace,4-copiesOfName(card.name)));
  }
  function lockPreviewScroll(){
    if(document.body.classList.contains("tcg-preview-open"))return;
    previewScrollY=window.scrollY||window.pageYOffset||0;
    document.body.classList.add("tcg-preview-open");
    document.body.style.top="-"+previewScrollY+"px";
  }
  function unlockPreviewScroll(){
    if(!document.body.classList.contains("tcg-preview-open"))return;
    document.body.classList.remove("tcg-preview-open");
    document.body.style.top="";
    window.scrollTo(0,previewScrollY);
  }
  function renderCardPreview(card){
    var modal=$(".tcg-card-preview-modal");
    if(modal)modal.classList.toggle("is-text-only",!card.image);
    var image=$("#tcgPreviewImage");
    if(image){
      image.innerHTML=card.image
        ?cardImageHtml(card.image,card.name,"high")
        :'<div class="tcg-preview-no-art"><strong>Artwork unavailable</strong><span>The card data is still shown below.</span></div>';
    }
    if($("#tcgPreviewName"))$("#tcgPreviewName").textContent=card.name||"Card";
    if($("#tcgPreviewReference"))$("#tcgPreviewReference").textContent=cardReferenceText(card)||"Set information unavailable";
    var details=[];
    if(card.category)details.push(card.category==="Pokemon"?"Pokémon":card.category);
    if(card.trainerType)details.push(card.trainerType);
    if(card.energyType)details.push(card.energyType+" Energy");
    if(card.regulationMark)details.push("Regulation "+card.regulationMark);
    if($("#tcgPreviewDetails"))$("#tcgPreviewDetails").textContent=details.join(" · ")||"";
    if($("#tcgPreviewCardInfo"))$("#tcgPreviewCardInfo").innerHTML=renderCardExtraInfo(card);
    var qty=$("#tcgPreviewQty");
    var addButton=$("#tcgPreviewAdd");
    var limit=previewQuantityLimit(card);
    if(qty){
      qty.value=limit>0?"1":"0";
      qty.min=limit>0?"1":"0";
      qty.max=String(limit);
      qty.disabled=limit<=0;
    }
    if(addButton){
      addButton.disabled=limit<=0;
      addButton.textContent=limit<=0?"Copy limit reached":"Add to deck";
    }
    var legality=$("#tcgPreviewLegality");
    if(legality){
      if(card.legal&&card.legal.standard===true){
        legality.className="tcg-preview-legality is-legal";
        legality.textContent="This printing is marked Standard legal.";
      }else if(card.legal&&card.legal.standard===false){
        legality.className="tcg-preview-legality is-review";
        legality.textContent="Review Standard legality — an older printing may still be usable if an equivalent legal reprint exists.";
      }else{
        legality.className="tcg-preview-legality";
        legality.textContent="Standard legality data unavailable for this printing.";
      }
    }
  }
  async function openCardPreview(id){
    if(!id)return;
    var dialog=$("#tcgCardPreviewDialog");if(!dialog)return;
    previewCard=null;
    if($("#tcgPreviewName"))$("#tcgPreviewName").textContent="Loading card…";
    if($("#tcgPreviewReference"))$("#tcgPreviewReference").textContent="";
    if($("#tcgPreviewDetails"))$("#tcgPreviewDetails").textContent="";
    if($("#tcgPreviewCardInfo"))$("#tcgPreviewCardInfo").innerHTML="";
    var modal=$(".tcg-card-preview-modal");if(modal)modal.classList.remove("is-text-only");
    if($("#tcgPreviewImage"))$("#tcgPreviewImage").innerHTML='<div class="tcg-preview-loading">Loading artwork…</div>';
    if($("#tcgPreviewAdd"))$("#tcgPreviewAdd").disabled=true;
    if($("#tcgPreviewQty")){
      $("#tcgPreviewQty").value="1";
      $("#tcgPreviewQty").disabled=true;
    }
    lockPreviewScroll();
    if(typeof dialog.showModal==="function"&&!dialog.open)dialog.showModal();
    try{
      var response=await fetch(API+"/cards/"+encodeURIComponent(id),{cache:"default"});
      if(!response.ok)throw new Error("Card lookup failed");
      var full=await response.json();
      previewCard=(await enrichCards([full]))[0]||full;
      renderCardPreview(previewCard);
      if($("#tcgPreviewAdd"))$("#tcgPreviewAdd").disabled=false;
    }catch(err){
      if($("#tcgPreviewName"))$("#tcgPreviewName").textContent="Could not load card";
      if($("#tcgPreviewReference"))$("#tcgPreviewReference").textContent="Close this preview and try again.";
    }
  }
  function closeCardPreview(){
    var dialog=$("#tcgCardPreviewDialog");
    if(dialog&&dialog.open)dialog.close();
    previewCard=null;
    unlockPreviewScroll();
  }
  async function hydrateStoredSetInfo(){
    var ids=[];
    state.cards.forEach(function(card){if(card.setId&&ids.indexOf(card.setId)===-1)ids.push(card.setId)});
    if(!ids.length)return;
    var metas=await Promise.all(ids.map(function(id){return getSetMeta(id)}));
    var byId={};metas.forEach(function(set,index){if(set)byId[ids[index]]=set});
    var changed=false;
    state.cards.forEach(function(card){
      var set=byId[card.setId];if(!set)return;
      var code=officialSetCode(set);
      var count=Number(set.cardCount&&set.cardCount.official||0)||0;
      if(card.setCode!==code||card.setName!==set.name||card.setOfficialCount!==count||card.setReleaseDate!==String(set.releaseDate||"")){
        card.setCode=code;
        card.setName=String(set.name||card.setName||"");
        card.setOfficialCount=count;
        card.setReleaseDate=String(set.releaseDate||"");
        changed=true;
      }
    });
    if(changed)renderDeck();
  }
  function changeQty(id,delta){
    var card=state.cards.filter(function(item){return item.id===id})[0];
    if(!card)return;
    card.qty=Math.max(0,Math.min(60,(Number(card.qty)||0)+delta));
    if(card.qty===0)state.cards=state.cards.filter(function(item){return item.id!==id});
    renderDeck();
    markDirty();
  }
  function removeCard(id){
    state.cards=state.cards.filter(function(card){return card.id!==id});
    renderDeck();
    markDirty();
  }
  function tournamentGroupHtml(category,label){
    var cards=categoryCards(category);
    var qty=cards.reduce(function(sum,card){return sum+(Number(card.qty)||0)},0);
    return '<section class="tcg-list-preview-group"><h3>'+esc(label)+' <span>'+qty+'</span></h3>'+
      (cards.length?cards.map(function(card){
        var ref=[String(card.setCode||""),String(card.localId||"")].filter(Boolean).join(" ");
        return '<div class="tcg-list-preview-row"><strong>'+esc(card.qty)+'×</strong><span>'+esc(card.name)+'</span><small>'+esc(ref||card.setName||"—")+'</small></div>';
      }).join(""):'<div class="tcg-list-preview-empty">No '+esc(label.toLowerCase())+'.</div>')+
    '</section>';
  }
  function openDeckListPreview(){
    var dialog=$("#tcgDeckListDialog");if(!dialog)return;
    var payload=exportDeck(accountUser),player=payload.player||{};
    $("#tcgListDeckName").textContent=state.name||"Untitled deck";
    $("#tcgListPlayer").textContent=player.playerName||"Player name not set";
    $("#tcgListPlayerId").textContent=player.playerId||"Player ID not set";
    $("#tcgListFormat").textContent="Standard";
    $("#tcgListTotal").textContent=payload.totals.total+" / 60";
    renderValidation();
    $("#tcgListGroups").innerHTML=tournamentGroupHtml("Pokemon","Pokémon")+tournamentGroupHtml("Trainer","Trainers")+tournamentGroupHtml("Energy","Energy");
    lockPreviewScroll();
    if(typeof dialog.showModal==="function"&&!dialog.open)dialog.showModal();
  }
  function closeDeckListPreview(){
    var dialog=$("#tcgDeckListDialog");
    if(dialog&&dialog.open)dialog.close();
    unlockPreviewScroll();
  }
  function openDeck(){
    if(window.VCGApp&&window.VCGApp.navigate)window.VCGApp.navigate("deck");
    var dialog=$("#newTeamDialog");
    if(dialog&&dialog.open)dialog.close();
    renderDeck();
    var name=$("#tcgDeckName");if(name)name.value=state.name||"";
  }
  function init(){
    load();
    var name=$("#tcgDeckName");
    if(name){
      name.value=state.name||"";
      name.addEventListener("input",function(){state.name=this.value;save();markDirty()});
    }
    var searchInput=$("#tcgCardSearch");
    if(searchInput){
      searchInput.addEventListener("input",function(){
        clearTimeout(searchTimer);
        var value=this.value;
        searchTimer=setTimeout(function(){search(value)},260);
      });
    }
    var results=$("#tcgSearchResults");
    if(results)results.addEventListener("click",function(e){
      var hit=e.target.closest("[data-tcg-card]");
      if(hit)openCardPreview(hit.dataset.tcgCard);
    });
    var groups=$("#tcgDeckGroups");
    if(groups)groups.addEventListener("click",function(e){
      var inc=e.target.closest("[data-tcg-inc]");
      var dec=e.target.closest("[data-tcg-dec]");
      var remove=e.target.closest("[data-tcg-remove]");
      if(inc)changeQty(inc.dataset.tcgInc,1);
      else if(dec)changeQty(dec.dataset.tcgDec,-1);
      else if(remove)removeCard(remove.dataset.tcgRemove);
    });
    var clear=$("#tcgClearDeck");
    if(clear)clear.addEventListener("click",function(){
      if(!state.cards.length)return;
      if(confirm("Clear every card from this TCG deck?")){
        state.cards=[];
        renderDeck();
        markDirty();
        emit("vcg:deckreset");
        setStatus("Deck cleared.");
      }
    });
    var listDialog=$("#tcgDeckListDialog");
    if($("#tcgDeckListPreviewButton"))$("#tcgDeckListPreviewButton").addEventListener("click",openDeckListPreview);
    if($("#tcgDeckListClose"))$("#tcgDeckListClose").addEventListener("click",closeDeckListPreview);
    if($("#tcgDeckListDone"))$("#tcgDeckListDone").addEventListener("click",closeDeckListPreview);
    if(listDialog){
      listDialog.addEventListener("click",function(e){if(e.target===this)closeDeckListPreview()});
      listDialog.addEventListener("cancel",function(e){e.preventDefault();closeDeckListPreview()});
      listDialog.addEventListener("close",function(){unlockPreviewScroll()});
    }
    var previewDialog=$("#tcgCardPreviewDialog");
    if($("#tcgPreviewClose"))$("#tcgPreviewClose").addEventListener("click",closeCardPreview);
    if($("#tcgPreviewCancel"))$("#tcgPreviewCancel").addEventListener("click",closeCardPreview);
    if($("#tcgPreviewAdd"))$("#tcgPreviewAdd").addEventListener("click",function(){
      if(!previewCard)return;
      var qty=$("#tcgPreviewQty");
      var limit=previewQuantityLimit(previewCard);
      var amount=Math.max(1,Math.min(limit,Number(qty&&qty.value)||1));
      if(limit<=0)return;
      addCard(previewCard.id,previewCard,amount).then(closeCardPreview);
    });
    if($("#tcgPreviewQty"))$("#tcgPreviewQty").addEventListener("input",function(){
      if(!previewCard)return;
      var limit=previewQuantityLimit(previewCard);
      var value=Number(this.value);
      if(value>limit)this.value=String(limit);
      if(value<1&&limit>0)this.value="1";
    });
    if(previewDialog){
      previewDialog.addEventListener("click",function(e){if(e.target===this)closeCardPreview()});
      previewDialog.addEventListener("cancel",function(e){e.preventDefault();closeCardPreview()});
      previewDialog.addEventListener("close",function(){unlockPreviewScroll()});
    }
    $$("[data-select-deck]").forEach(function(button){button.addEventListener("click",openDeck)});
    document.addEventListener("error",function(e){
      if(e.target&&e.target.matches&&e.target.matches(".tcg-card-image"))handleCardImageError(e.target);
    },true);
    document.addEventListener("vcg:navigate",function(e){if(e.detail&&e.detail.target==="deck")renderDeck()});
    renderDeck();
    hydrateStoredSetInfo().catch(function(){});
  }

  window.VCGTCG={
    exportDeck:exportDeck,
    importDeck:importDeck,
    setDeckName:setDeckName,
    setAccountUser:function(user){accountUser=user||null},
    renderDeck:renderDeck
  };

  document.addEventListener("DOMContentLoaded",init);
})();