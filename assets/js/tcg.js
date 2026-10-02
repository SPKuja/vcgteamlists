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
  function standardWarnings(){
    return state.cards.filter(function(card){return card.legal&&card.legal.standard===false});
  }
  function renderValidation(){
    var target=$("#tcgValidation");if(!target)return;
    var count=total();
    var items=[];
    if(count===60)items.push({type:"ok",text:"60 cards — deck size is correct."});
    else if(count<60)items.push({type:"warn",text:"Add "+(60-count)+" more card"+(60-count===1?"":"s")+" to reach 60."});
    else items.push({type:"error",text:"Remove "+(count-60)+" card"+(count-60===1?"":"s")+" — constructed decks must contain exactly 60 cards."});

    var over=nameTotals().filter(function(item){return item.count>4});
    if(over.length){
      items.push({type:"error",text:"Four-copy limit exceeded: "+over.map(function(item){return item.name+" ×"+item.count}).join(", ")+". Basic Energy is exempt."});
    }else if(state.cards.length){
      items.push({type:"ok",text:"No four-copy rule conflicts detected."});
    }

    var flagged=standardWarnings();
    if(flagged.length){
      var names=[];
      flagged.forEach(function(card){if(names.indexOf(card.name)===-1)names.push(card.name)});
      items.push({type:"warn",text:"Standard check: "+names.slice(0,5).join(", ")+(names.length>5?" and "+(names.length-5)+" more":"")+" include a printing TCGdex does not mark Standard legal. Older printings may still be usable when an equivalent current reprint exists, so treat this as a review flag rather than a hard block."});
    }
    target.innerHTML=items.map(function(item){return '<div class="tcg-validation-item '+item.type+'">'+esc(item.text)+'</div>'}).join("");
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
  function energyCostHtml(cost){
    if(!Array.isArray(cost)||!cost.length)return "";
    return '<span class="tcg-energy-cost">'+cost.map(function(item){
      return '<b title="'+esc(item)+'">'+esc(String(item).slice(0,2).toUpperCase())+'</b>';
    }).join("")+'</span>';
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
    if(Array.isArray(card.weaknesses)&&card.weaknesses.length)battle.push('<div><small>Weakness</small><strong>'+esc(card.weaknesses.map(function(item){return item.type+(item.value?" "+item.value:"")}).join(", "))+'</strong></div>');
    if(Array.isArray(card.resistances)&&card.resistances.length)battle.push('<div><small>Resistance</small><strong>'+esc(card.resistances.map(function(item){return item.type+(item.value?" "+item.value:"")}).join(", "))+'</strong></div>');
    if(card.retreat!==undefined&&card.retreat!==null)battle.push('<div><small>Retreat</small><strong>'+esc(card.retreat)+'</strong></div>');
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
  async function addCard(id,cardData){
    if(!id)return;
    setStatus("Adding card…");
    try{
      var full=cardData||null;
      if(!full){
        var response=await fetch(API+"/cards/"+encodeURIComponent(id),{cache:"default"});
        if(!response.ok)throw new Error("Card lookup failed");
        full=await response.json();
      }
      full=(await enrichCards([full]))[0]||full;
      var existing=state.cards.filter(function(card){return card.id===id})[0];
      if(existing)existing.qty=Math.min(60,existing.qty+1);
      else state.cards.push(normaliseCard(full));
      renderDeck();
      setStatus((full.name||"Card")+" added to deck.");
    }catch(err){
      setStatus("Could not add that card. Try again.");
    }
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
  }
  function removeCard(id){
    state.cards=state.cards.filter(function(card){return card.id!==id});
    renderDeck();
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
      name.addEventListener("input",function(){state.name=this.value;save()});
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
        setStatus("Deck cleared.");
      }
    });
    var previewDialog=$("#tcgCardPreviewDialog");
    if($("#tcgPreviewClose"))$("#tcgPreviewClose").addEventListener("click",closeCardPreview);
    if($("#tcgPreviewCancel"))$("#tcgPreviewCancel").addEventListener("click",closeCardPreview);
    if($("#tcgPreviewAdd"))$("#tcgPreviewAdd").addEventListener("click",function(){
      if(!previewCard)return;
      addCard(previewCard.id,previewCard).then(closeCardPreview);
    });
    if(previewDialog)previewDialog.addEventListener("click",function(e){if(e.target===this)closeCardPreview()});
    $$("[data-select-deck]").forEach(function(button){button.addEventListener("click",openDeck)});
    document.addEventListener("error",function(e){
      if(e.target&&e.target.matches&&e.target.matches(".tcg-card-image"))handleCardImageError(e.target);
    },true);
    document.addEventListener("vcg:navigate",function(e){if(e.detail&&e.detail.target==="deck")renderDeck()});
    renderDeck();
    hydrateStoredSetInfo().catch(function(){});
  }

  document.addEventListener("DOMContentLoaded",init);
})();