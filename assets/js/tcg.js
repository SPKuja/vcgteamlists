(function(){
  "use strict";

  var API="https://api.tcgdex.net/v2/en";
  var STORAGE_KEY="vcg-tcg-deck-v1";
  var state={name:"",cards:[]};
  var searchTimer=null;
  var searchAbort=null;

  function $(s,root){return (root||document).querySelector(s)}
  function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}
  function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]})}
  function imageUrl(base,quality){
    if(!base)return "";
    return String(base).replace(/\/$/,"")+"/"+(quality||"low")+".webp";
  }
  function normaliseCard(card){
    return {
      id:String(card.id||""),
      name:String(card.name||"Unknown card"),
      category:String(card.category||"Other"),
      energyType:String(card.energyType||""),
      trainerType:String(card.trainerType||""),
      setId:String(card.set&&card.set.id||card.setId||""),
      setName:String(card.set&&card.set.name||card.setName||""),
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
    return card.category==="Energy"&&String(card.energyType||"").toLowerCase()==="basic";
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
    var meta=[card.setName,card.localId?"#"+card.localId:"",card.regulationMark?"Reg. "+card.regulationMark:""].filter(Boolean).join(" · ");
    var flag=card.legal&&card.legal.standard===false?'<span class="tcg-standard-flag">CHECK</span>':"";
    return '<article class="tcg-deck-card" data-tcg-deck-card="'+esc(card.id)+'">'+
      (card.image?'<img src="'+esc(imageUrl(card.image,"low"))+'" alt="">':'<div></div>')+
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
  function renderSearchResults(cards){
    var target=$("#tcgSearchResults");if(!target)return;
    if(!cards.length){
      target.innerHTML='<div class="tcg-search-empty">No matching cards found.</div>';
      return;
    }
    target.innerHTML=cards.map(function(card){
      return '<button type="button" class="tcg-search-result" data-tcg-card="'+esc(card.id)+'">'+
        (card.image?'<img src="'+esc(imageUrl(card.image,"low"))+'" alt="">':'<div></div>')+
        '<span class="tcg-search-result-copy"><strong>'+esc(card.name)+'</strong><small>'+esc(card.id)+' · #'+esc(card.localId)+'</small></span>'+
      '</button>';
    }).join("");
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
      var url=API+"/cards?name="+encodeURIComponent(q)+"&pagination:page=1&pagination:itemsPerPage=24";
      var response=await fetch(url,{signal:searchAbort.signal,cache:"default"});
      if(!response.ok)throw new Error("Card search failed");
      var cards=await response.json();
      cards=Array.isArray(cards)?cards:[];
      renderSearchResults(cards);
      setStatus(cards.length?"Showing "+cards.length+" matching printing"+(cards.length===1?"":"s")+".":"No matching cards found.");
    }catch(err){
      if(err&&err.name==="AbortError")return;
      setStatus("Card search is temporarily unavailable.");
      if(target)target.innerHTML='<div class="tcg-search-empty">Could not load cards. Try again.</div>';
    }
  }
  async function addCard(id){
    if(!id)return;
    setStatus("Adding card…");
    try{
      var response=await fetch(API+"/cards/"+encodeURIComponent(id),{cache:"default"});
      if(!response.ok)throw new Error("Card lookup failed");
      var full=await response.json();
      var existing=state.cards.filter(function(card){return card.id===id})[0];
      if(existing)existing.qty=Math.min(60,existing.qty+1);
      else state.cards.push(normaliseCard(full));
      renderDeck();
      setStatus((full.name||"Card")+" added to deck.");
    }catch(err){
      setStatus("Could not add that card. Try again.");
    }
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
      if(hit)addCard(hit.dataset.tcgCard);
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
    $$("[data-select-deck]").forEach(function(button){button.addEventListener("click",openDeck)});
    document.addEventListener("vcg:navigate",function(e){if(e.detail&&e.detail.target==="deck")renderDeck()});
    renderDeck();
  }

  document.addEventListener("DOMContentLoaded",init);
})();