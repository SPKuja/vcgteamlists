(function(){
  "use strict";

  function $(s,root){return (root||document).querySelector(s)}
  function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]})}
  var GO_POKEDEX_API="https://pokemon-go-api.github.io/pokemon-go-api/api/pokedex";

  function gameName(game){return {champions:"Pokémon Champions",sv:"Scarlet / Violet",swsh:"Sword / Shield",go:"Pokémon GO",custom:"Custom / Other"}[game]||"Pokémon team"}

  function normaliseGoArtId(value){
    return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"")
      .replace(/_shadow$/,"").replace(/_alolan(?=_|$)/g,"_alola").replace(/_galarian(?=_|$)/g,"_galar")
      .replace(/_hisuian(?=_|$)/g,"_hisui").replace(/_paldean(?=_|$)/g,"_paldea");
  }

  function goNameCandidates(value){
    var raw=String(value||"").replace(/_shadow$/i,"").toUpperCase(),values=raw?[raw]:[];
    [["_ALOLAN","_ALOLA"],["_GALAR","_GALARIAN"],["_HISUI","_HISUIAN"],["_PALDEA","_PALDEAN"]].forEach(function(pair){
      values.slice().forEach(function(candidate){
        if(candidate.indexOf(pair[0])!==-1)values.push(candidate.replace(pair[0],pair[1]));
        if(candidate.indexOf(pair[1])!==-1)values.push(candidate.replace(pair[1],pair[0]));
      });
    });
    return values.filter(function(candidate,index){return values.indexOf(candidate)===index});
  }

  async function resolveSharedGoArtwork(mon){
    var names=goNameCandidates(mon.goSpeciesId||mon.slug);
    for(var i=0;i<names.length;i++){
      try{
        var response=await fetch(GO_POKEDEX_API+"/name/"+encodeURIComponent(names[i])+".json",{cache:"default"});
        if(!response.ok)continue;
        var payload=await response.json();
        if(payload&&payload.assets&&payload.assets.image)return payload.assets.image;
      }catch(e){}
    }
    return mon.image||"";
  }
  function displayName(mon){
    return mon&&mon.form&&mon.form!=="Standard"?(mon.name+" — "+mon.form):(mon&&mon.name)||"Pokémon";
  }

  function render(team){
    $("#sharedTeamName").textContent=team.name||"Shared team";
    $("#sharedGameName").textContent=gameName(team.game);
    var mons=team.payload&&Array.isArray(team.payload.team)?team.payload.team.filter(function(mon){return mon&&mon.name}).slice(0,6):[];
    var grid=$("#sharedTeamGrid");
    grid.innerHTML=mons.map(function(mon){
      var moves=(mon.moves||[]).filter(Boolean).map(function(move){return '<li>'+esc(move)+'</li>'}).join("");
      var details=[];
      if(team.game==="go"){
        var ivs=mon.goIVs||{};
        details.push('<div><small>CP</small><strong>'+esc(mon.goCP||"—")+'</strong></div>');
        details.push('<div><small>Level</small><strong>'+esc(mon.goLevel||"—")+'</strong></div>');
        details.push('<div><small>IVs A / D / HP</small><strong>'+esc(ivs.attack||0)+' / '+esc(ivs.defense||0)+' / '+esc(ivs.hp||0)+'</strong></div>');
        if(mon.goShadow)details.push('<div><small>Variant</small><strong>Shadow</strong></div>');
      }else{
        if(mon.ability)details.push('<div><small>Ability</small><strong>'+esc(mon.ability)+'</strong></div>');
        if(mon.item)details.push('<div><small>Held item</small><strong>'+esc(mon.item)+'</strong></div>');
        if(mon.alignment)details.push('<div><small>Nature / alignment</small><strong>'+esc(mon.alignment)+'</strong></div>');
        if(mon.teraType)details.push('<div><small>Tera Type</small><strong>'+esc(mon.teraType)+'</strong></div>');
      }
      return '<article class="shared-mon-card">'+
        '<div class="shared-mon-art'+(team.game==="go"&&mon.goShadow?' go-shadow-art':'')+'" data-go-species="'+esc(mon.goSpeciesId||"")+'">'+(mon.image?'<img src="'+esc(mon.image)+'" alt="">':'')+'</div>'+
        '<div class="shared-mon-copy">'+
          '<h2>'+esc(displayName(mon))+'</h2>'+
          '<div class="shared-mon-details">'+details.join("")+'</div>'+
          (moves?'<ul class="shared-mon-moves">'+moves+'</ul>':'')+
        '</div>'+
      '</article>';
    }).join("");
    $("#sharedLoading").hidden=true;
    grid.hidden=false;

    if(team.game==="go"){
      var cards=Array.prototype.slice.call(grid.querySelectorAll(".shared-mon-card"));
      Promise.all(mons.map(function(mon,index){
        return resolveSharedGoArtwork(mon).then(function(url){
          var img=cards[index]&&cards[index].querySelector(".shared-mon-art img");
          if(img&&url)img.src=url;
        });
      })).catch(function(){});
    }
  }

  async function init(){
    var token=new URLSearchParams(location.search).get("token")||"";
    if(!token){$("#sharedLoading").hidden=true;$("#sharedError").hidden=false;return}
    try{
      var response=await fetch("/api/team-share.php?token="+encodeURIComponent(token),{headers:{"Accept":"application/json"},cache:"no-store"});
      var data=await response.json();
      if(!response.ok||!data.team)throw new Error(data.error||"Shared team unavailable");
      render(data.team);
    }catch(err){
      $("#sharedLoading").hidden=true;
      $("#sharedError").hidden=false;
    }
  }

  init();
})();