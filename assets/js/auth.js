(function(){
  "use strict";

  var auth={csrf:"",user:null,teams:[],decks:[],currentTeamId:null,currentDeckId:null,resetToken:""};

  function $(s,root){return (root||document).querySelector(s)}
  function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}
  function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]})}

  function shouldAutoFocus(){
    return !window.matchMedia || window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function message(target,text,isError){
    var el=$(target);if(!el)return;
    el.textContent=text||"";
    el.classList.toggle("is-error",!!isError);
  }

  async function refreshSession(){
    var response=await fetch("/api/session.php",{credentials:"same-origin",cache:"no-store"});
    var data=await response.json();
    auth.csrf=data.csrf||"";
    auth.user=data.authenticated?data.user:null;
    renderAuth();
    return data;
  }

  async function api(path,options,retry){
    options=options||{};
    var method=(options.method||"GET").toUpperCase();
    var headers=Object.assign({"Accept":"application/json"},options.headers||{});
    var body=options.body;
    if(method!=="GET"){
      headers["X-CSRF-Token"]=auth.csrf;
      if(body&&!(body instanceof FormData)){headers["Content-Type"]="application/json";body=JSON.stringify(body)}
    }
    var response=await fetch("/api/"+path,{method:method,headers:headers,body:body,credentials:"same-origin",cache:"no-store"});
    var data={};
    try{data=await response.json()}catch(e){data={error:"The server returned an invalid response."}}
    if(response.status===419&&!retry){await refreshSession();return api(path,options,true)}
    if(!response.ok){
      var err=new Error(data.error||"Request failed.");err.status=response.status;err.code=data.code||"";throw err;
    }
    return data;
  }

  function setPane(name){
    ["login","register","forgot","reset"].forEach(function(p){
      var form=$("#"+p+"Form");if(form)form.hidden=p!==name;
    });
    $("#registeredPane").hidden=name!=="registered";
    $$(".account-tabs [data-auth-pane]").forEach(function(btn){btn.classList.toggle("is-selected",btn.dataset.authPane===name)});
    $(".account-tabs").hidden=name==="forgot"||name==="reset"||name==="registered";
    $("#resendVerificationButton").hidden=true;
    message("#authMessage","");
  }

  function showProfile(pane){
    if(window.VCGApp)window.VCGApp.navigate("profile");
    if(!auth.user)setPane(pane||"login");
  }

  function renderAccountButton(){
    var label=$("#accountLabel"),avatar=$("#accountAvatar");
    if(auth.user){
      label.textContent=auth.user.playerName||auth.user.trainerName||auth.user.email.split("@")[0];
      avatar.textContent="";
      avatar.style.backgroundImage="url('"+auth.user.avatarUrl+"')";
      avatar.classList.add("has-image");
    }else{
      label.textContent="Sign in";
      avatar.textContent="●";
      avatar.style.backgroundImage="";
      avatar.classList.remove("has-image");
    }
  }

  function renderProfile(){
    if(!auth.user)return;
    $("#profileEmail").textContent=auth.user.email;
    $("#accountEmail").value=auth.user.email;
    $("#profileAvatar").src=auth.user.avatarUrl;
    $("#profilePlayerName").value=auth.user.playerName||"";
    $("#profileTrainerName").value=auth.user.trainerName||"";
    $("#profilePlayerId").value=auth.user.playerId||"";
    $("#profileYearOfBirth").value=auth.user.yearOfBirth||"";
    $("#removeAvatarButton").hidden=auth.user.avatarMode!=="custom";
    renderPlayQr();
  }

  function playQrExpiryDate(){
    var now=new Date();
    var last=new Date(now.getFullYear(),now.getMonth()+1,0);
    return last.getFullYear()+"-"+String(last.getMonth()+1).padStart(2,"0")+"-"+String(last.getDate()).padStart(2,"0");
  }

  function playQrNameParts(fullName){
    var parts=String(fullName||"").trim().split(/\s+/).filter(Boolean);
    return {
      first:parts[0]||"",
      lastInitial:parts.length>1?(Array.from(parts[parts.length-1])[0]||"").toUpperCase():""
    };
  }

  function utf8Base64(value){
    var bytes=new TextEncoder().encode(value),binary="";
    for(var i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function drawPlayQr(canvas,text){
    if(!window.qrcodegen||!window.qrcodegen.QrCode)return false;
    var qr=window.qrcodegen.QrCode.encodeText(text,window.qrcodegen.QrCode.Ecc.HIGH);
    var border=4,moduleSize=7,size=(qr.size+border*2)*moduleSize;
    canvas.width=size;canvas.height=size;
    var ctx=canvas.getContext("2d");
    ctx.imageSmoothingEnabled=false;
    ctx.fillStyle="#fff";ctx.fillRect(0,0,size,size);
    ctx.fillStyle="#000";
    for(var y=0;y<qr.size;y++){
      for(var x=0;x<qr.size;x++){
        if(qr.getModule(x,y)){
          ctx.fillRect((x+border)*moduleSize,(y+border)*moduleSize,moduleSize,moduleSize);
        }
      }
    }
    return true;
  }

  function renderPlayQr(){
    var box=$("#playQrBox");if(!box)return;
    var name=$("#profilePlayerName").value.trim();
    var playerId=$("#profilePlayerId").value.trim();
    var birthYear=$("#profileYearOfBirth").value.trim();
    var names=playQrNameParts(name);
    var expiry=playQrExpiryDate();

    $("#playQrFirst").textContent=names.first||"—";
    $("#playQrLast").textContent=names.lastInitial||"—";
    $("#playQrPlayerId").textContent=playerId||"—";
    $("#playQrBirthYear").textContent=birthYear||"—";

    var ready=!!(names.first&&names.lastInitial&&playerId&&/^\d{4}$/.test(birthYear));
    var canvas=$("#playQrCanvas"),placeholder=$("#playQrPlaceholder");
    canvas.hidden=true;placeholder.hidden=false;
    if(!ready)return;

    var payload=JSON.stringify({pi:playerId,fn:names.first,li:names.lastInitial,by:birthYear,e:expiry});
    var encoded=utf8Base64(payload);
    if(drawPlayQr(canvas,encoded)){
      canvas.hidden=false;placeholder.hidden=true;
    }else{
      placeholder.querySelector("strong").textContent="QR generator unavailable";
      placeholder.querySelector("span").textContent="Refresh the page and try again.";
    }
  }

  function renderAuth(){
    renderAccountButton();
    $("#accountGuest").hidden=!!auth.user;
    $("#accountUser").hidden=!auth.user;
    $("#teamsGuest").hidden=!!auth.user;
    $("#teamsUser").hidden=!auth.user;
    if(auth.user){
      renderProfile();
      if(window.VCGApp)window.VCGApp.applyProfileDefaults(auth.user,false);
    }else{
      auth.teams=[];auth.decks=[];auth.currentTeamId=null;auth.currentDeckId=null;renderTeams();
    }
    if(window.VCGTCG&&window.VCGTCG.setAccountUser)window.VCGTCG.setAccountUser(auth.user);
    updateBuilderSaveButton(false);
    updateDeckSaveButton(false);
  }

  function friendlyGame(game){
    return {champions:"Pokémon Champions",sv:"Scarlet / Violet",swsh:"Sword / Shield",go:"Pokémon GO",tcg:"Pokémon TCG",custom:"Custom / Other"}[game]||game;
  }
  function friendlyFormat(format){
    return {standard:"Standard",expanded:"Expanded",unlimited:"Unlimited"}[format]||format||"Standard";
  }

  function gameLogoHtml(game){
    if(game==="champions")return '<div class="cloud-game-logos single" aria-hidden="true"><img src="/images/pokemon_champions.webp" alt=""></div>';
    if(game==="sv")return '<div class="cloud-game-logos dual" aria-hidden="true"><img src="/images/pokemon_scarlet.webp" alt=""><img src="/images/pokemon_violet.webp" alt=""></div>';
    if(game==="swsh")return '<div class="cloud-game-logos dual" aria-hidden="true"><img src="/images/pokemon_sword.webp" alt=""><img src="/images/pokemon_shield.webp" alt=""></div>';
    if(game==="go")return '<div class="cloud-game-logos single go-cloud-mark" aria-hidden="true"><img src="/images/pokemon_go.svg" alt=""></div>';
    if(game==="tcg")return '<div class="cloud-game-logos single tcg-cloud-mark" aria-hidden="true"><img src="/images/pokemon_tcg.webp" alt=""></div>';
    return '<div class="cloud-game-logos single generic" aria-hidden="true"><img src="/images/pokemon.svg" alt=""></div>';
  }

  function teamImages(team){
    var mons=team.payload&&Array.isArray(team.payload.team)?team.payload.team.filter(Boolean).slice(0,6):[];
    return mons.map(function(mon){return mon.image?'<img src="'+esc(mon.image)+'" alt="">':''}).join("");
  }

  function deckImages(deck){
    var cards=deck.payload&&Array.isArray(deck.payload.cards)?deck.payload.cards.filter(function(card){return card&&card.image}).slice(0,4):[];
    return cards.map(function(card){return '<img src="'+esc(String(card.image).replace(/\/$/,"")+"/low.webp")+'" alt="">' }).join("");
  }

  function renderTeams(){
    var list=$("#cloudTeamList");if(!list)return;
    var builds=auth.teams.map(function(team){return {kind:"team",item:team,updatedAt:team.updatedAt||""}})
      .concat(auth.decks.map(function(deck){return {kind:"deck",item:deck,updatedAt:deck.updatedAt||""}}))
      .sort(function(a,b){return String(b.updatedAt).localeCompare(String(a.updatedAt))});
    var count=$("#savedTeamCount");
    if(count)count.textContent=builds.length+" "+(builds.length===1?"build":"builds");
    if(!auth.user){list.innerHTML="";return}
    if(!builds.length){
      list.innerHTML='<div class="cloud-empty"><strong>No saved builds yet</strong><span>Save a team or TCG deck and it will appear here.</span></div>';
      return;
    }
    list.innerHTML=builds.map(function(build){
      if(build.kind==="deck"){
        var deck=build.item;
        var cards=deck.payload&&Array.isArray(deck.payload.cards)?deck.payload.cards:[];
        var total=cards.reduce(function(sum,card){return sum+(Number(card.qty)||0)},0);
        var selectedDeck=Number(auth.currentDeckId)===Number(deck.id);
        return '<article class="cloud-team cloud-deck'+(selectedDeck?' is-current':'')+'" data-deck-id="'+deck.id+'">'+
          '<button type="button" class="cloud-team-open" data-load-deck="'+deck.id+'">'+
            '<div class="cloud-deck-images">'+(deckImages(deck)||'<span class="cloud-deck-placeholder">TCG</span>')+'</div>'+
            '<div class="cloud-team-copy"><strong>'+esc(deck.name)+'</strong><small>Pokémon TCG · '+esc(friendlyFormat(deck.format))+' · '+total+'/60 cards</small></div>'+
            gameLogoHtml("tcg")+
          '</button>'+
          '<div class="cloud-team-actions">'+
            '<button type="button" data-rename-deck="'+deck.id+'">Rename</button>'+
            '<button type="button" data-duplicate-deck="'+deck.id+'">Duplicate</button>'+
            '<button type="button" class="danger-link" data-delete-deck="'+deck.id+'">Delete</button>'+
          '</div>'+
        '</article>';
      }
      var team=build.item;
      var selected=Number(auth.currentTeamId)===Number(team.id);
      var mons=team.payload&&Array.isArray(team.payload.team)?team.payload.team.filter(Boolean):[];
      return '<article class="cloud-team'+(selected?' is-current':'')+'" data-team-id="'+team.id+'">'+
        '<button type="button" class="cloud-team-open" data-load-team="'+team.id+'">'+
          '<div class="cloud-team-images">'+teamImages(team)+'</div>'+
          '<div class="cloud-team-copy"><strong>'+esc(team.name)+'</strong><small>'+esc(friendlyGame(team.game))+' · '+mons.length+'/6 Pokémon</small></div>'+
          gameLogoHtml(team.game)+
        '</button>'+
        '<div class="cloud-team-actions">'+
          '<button type="button" data-share-team="'+team.id+'">Share link</button>'+
          (team.isShared?'<button type="button" data-revoke-share="'+team.id+'">Revoke link</button>':'')+
          '<button type="button" data-rename-team="'+team.id+'">Rename</button>'+
          '<button type="button" data-duplicate-team="'+team.id+'">Duplicate</button>'+
          '<button type="button" class="danger-link" data-delete-team="'+team.id+'">Delete</button>'+
        '</div>'+
      '</article>';
    }).join("");
  }

  async function loadTeams(){
    if(!auth.user)return;
    try{
      var results=await Promise.all([api("teams.php"),api("decks.php")]);
      auth.teams=results[0].teams||[];
      auth.decks=results[1].decks||[];
      renderTeams();
    }catch(err){message("#teamPageMessage",err.message,true)}
  }

  function suggestedTeamName(payload){
    var mons=(payload.team||[]).filter(function(mon){return mon&&mon.name}).slice(0,2).map(function(mon){return mon.name});
    if(mons.length)return mons.join(" / ");
    return window.VCGApp.defaultTeamName();
  }

  function updateBuilderSaveButton(savedNow){
    var btn=$("#saveCloudButton");if(!btn)return;
    btn.hidden=!auth.user;
    if(!auth.user)return;
    btn.textContent=savedNow?"✓ Saved":(auth.currentTeamId?"Update Team":"Save Team");
  }
  function updateDeckSaveButton(savedNow){
    var btn=$("#saveDeckCloudButton");if(!btn)return;
    btn.hidden=!auth.user;
    if(!auth.user)return;
    btn.textContent=savedNow?"✓ Saved":(auth.currentDeckId?"Update Deck":"Save Deck");
  }
  function openSaveDeckDialog(){
    if(!auth.user||!window.VCGTCG)return;
    var payload=window.VCGTCG.exportDeck(auth.user);
    var existing=auth.decks.filter(function(d){return Number(d.id)===Number(auth.currentDeckId)})[0];
    $("#saveDeckName").value=existing?existing.name:(payload.deckName||"");
    $("#saveDeckDialogEyebrow").textContent=existing?"Update deck":"Save deck";
    $("#saveDeckDialogTitle").textContent=existing?"Update your deck":"Name your deck";
    $("#saveDeckSubmit").textContent=existing?"Update Deck":"Save Deck";
    message("#saveDeckMessage","");
    var dialog=$("#saveDeckDialog");
    if(dialog&&typeof dialog.showModal==="function"){
      dialog.showModal();
      if(shouldAutoFocus())setTimeout(function(){$("#saveDeckName").focus();$("#saveDeckName").select()},50);
    }
  }
  function closeSaveDeckDialog(){
    var dialog=$("#saveDeckDialog");if(dialog&&dialog.open)dialog.close();
  }
  async function saveFromDeck(event){
    if(event)event.preventDefault();
    if(!auth.user||!window.VCGTCG)return;
    var name=$("#saveDeckName").value.trim();
    if(!name){message("#saveDeckMessage","Enter a deck name.",true);return}
    var existing=auth.decks.filter(function(d){return Number(d.id)===Number(auth.currentDeckId)})[0];
    window.VCGTCG.setDeckName(name);
    var payload=window.VCGTCG.exportDeck(auth.user);
    payload.deckName=name;
    try{
      var data=await api("decks.php",{method:"POST",body:{
        id:auth.currentDeckId||undefined,name:name,format:payload.format||"standard",payload:payload
      }});
      auth.currentDeckId=data.deck.id;
      await loadTeams();
      closeSaveDeckDialog();
      updateDeckSaveButton(true);
      if(window.VCGApp)window.VCGApp.toast(existing?"Deck updated":"Deck saved to your account");
      setTimeout(function(){updateDeckSaveButton(false)},1600);
    }catch(err){message("#saveDeckMessage",err.message,true)}
  }

  function openSaveTeamDialog(){
    if(!auth.user)return;
    var payload=window.VCGApp.exportTeam();
    var existing=auth.teams.filter(function(t){return Number(t.id)===Number(auth.currentTeamId)})[0];
    $("#saveTeamName").value=existing?existing.name:suggestedTeamName(payload);
    $("#saveTeamDialogEyebrow").textContent=existing?"Update team":"Save team";
    $("#saveTeamDialogTitle").textContent=existing?"Update your team":"Name your team";
    $("#saveTeamSubmit").textContent=existing?"Update Team":"Save Team";
    message("#saveTeamMessage","");
    var dialog=$("#saveTeamDialog");
    if(dialog&&typeof dialog.showModal==="function"){
      dialog.showModal();
      if(shouldAutoFocus())setTimeout(function(){$("#saveTeamName").focus();$("#saveTeamName").select()},50);
    }
  }

  function closeSaveTeamDialog(){
    var dialog=$("#saveTeamDialog");
    if(dialog&&dialog.open)dialog.close();
  }

  async function saveFromBuilder(event){
    if(event)event.preventDefault();
    if(!auth.user)return;
    var payload=window.VCGApp.exportTeam();
    var existing=auth.teams.filter(function(t){return Number(t.id)===Number(auth.currentTeamId)})[0];
    var name=$("#saveTeamName").value.trim();
    if(!name){message("#saveTeamMessage","Enter a team name.",true);return}
    try{
      var data=await api("teams.php",{method:"POST",body:{
        id:auth.currentTeamId||undefined,name:name,game:payload.game,payload:payload
      }});
      auth.currentTeamId=data.team.id;
      if(window.VCGApp)window.VCGApp.markSaved();
      await loadTeams();
      closeSaveTeamDialog();
      updateBuilderSaveButton(true);
      window.VCGApp.toast(existing?"Team updated":"Team saved to your account");
      setTimeout(function(){updateBuilderSaveButton(false)},1600);
    }catch(err){message("#saveTeamMessage",err.message,true)}
  }

  async function login(event){
    event.preventDefault();message("#authMessage","");
    try{
      var data=await api("login.php",{method:"POST",body:{
        email:$("#loginEmail").value.trim(),password:$("#loginPassword").value
      }});
      auth.csrf=data.csrf||auth.csrf;
      auth.user=data.user;
      renderAuth();
      await loadTeams();
      message("#profileMessage","");
    }catch(err){
      message("#authMessage",err.message,true);
      if(err.code==="email_not_verified")$("#resendVerificationButton").hidden=false;
    }
  }

  async function register(event){
    event.preventDefault();
    var password=$("#registerPassword").value;
    if(password!==$("#registerPasswordConfirm").value){message("#authMessage","Passwords do not match.",true);return}
    try{
      if(!$("#registerTerms").checked){message("#authMessage","Please agree to the Terms & Conditions and acknowledge the Privacy Notice.",true);return}
      await api("register.php",{method:"POST",body:{email:$("#registerEmail").value.trim(),password:password,acceptTerms:true}});
      var email=$("#registerEmail").value.trim();
      $("#loginEmail").value=email;$("#registeredEmail").textContent=email;
      $("#registerPassword").value="";$("#registerPasswordConfirm").value="";$("#registerTerms").checked=false;
      setPane("registered");
    }catch(err){message("#authMessage",err.message,true)}
  }

  async function resendVerification(){
    var email=$("#loginEmail").value.trim()||$("#registerEmail").value.trim()||$("#registeredEmail").textContent.trim();
    if(!email){message("#authMessage","Enter your email address first.",true);return}
    try{
      var data=await api("resend-verification.php",{method:"POST",body:{email:email}});
      message("#authMessage",data.message||"Verification email sent.");
    }catch(err){message("#authMessage",err.message,true)}
  }

  async function forgot(event){
    event.preventDefault();
    try{
      var data=await api("request-password-reset.php",{method:"POST",body:{email:$("#forgotEmail").value.trim()}});
      message("#authMessage",data.message||"Check your email.");
    }catch(err){message("#authMessage",err.message,true)}
  }

  async function resetPassword(event){
    event.preventDefault();
    var password=$("#resetPassword").value;
    if(password!==$("#resetPasswordConfirm").value){message("#authMessage","Passwords do not match.",true);return}
    try{
      var data=await api("reset-password.php",{method:"POST",body:{token:auth.resetToken,password:password}});
      history.replaceState({},document.title,"/profile");
      auth.resetToken="";
      setPane("login");
      message("#authMessage",data.message||"Password updated.");
    }catch(err){message("#authMessage",err.message,true)}
  }

  async function saveProfile(event){
    event.preventDefault();
    try{
      var data=await api("profile.php",{method:"POST",body:{
        playerName:$("#profilePlayerName").value.trim(),
        trainerName:$("#profileTrainerName").value.trim(),
        playerId:$("#profilePlayerId").value.trim(),
        yearOfBirth:$("#profileYearOfBirth").value.trim()
      }});
      auth.user=data.user;renderAuth();
      if(window.VCGApp)window.VCGApp.applyProfileDefaults(auth.user,true);
      message("#profileMessage","");
      $("#profileSavedState").hidden=false;
      $("#profileSaveButton").textContent="✓ Saved";
      setTimeout(function(){$("#profileSavedState").hidden=true;$("#profileSaveButton").textContent="Save profile"},2200);
    }catch(err){message("#profileMessage",err.message,true)}
  }

  async function changeEmail(event){
    event.preventDefault();
    message("#changeEmailMessage","");
    var email=$("#accountEmail").value.trim();
    var password=$("#changeEmailPassword").value;
    if(!email||!password){message("#changeEmailMessage","Enter your new email and current password.",true);return}
    try{
      var data=await api("account.php",{method:"POST",body:{action:"email",email:email,currentPassword:password}});
      $("#changeEmailPassword").value="";
      auth.user=null;auth.teams=[];auth.decks=[];auth.currentTeamId=null;auth.currentDeckId=null;
      await refreshSession();
      $("#loginEmail").value=email;
      setPane("login");
      message("#authMessage",data.message||"Email updated. Check your new email to verify it.");
      window.VCGApp.navigate("profile",{skipBuildGuard:true});
    }catch(err){message("#changeEmailMessage",err.message,true)}
  }

  async function changePassword(event){
    event.preventDefault();
    message("#changePasswordMessage","");
    var current=$("#currentPassword").value;
    var next=$("#newPassword").value;
    var confirmPassword=$("#newPasswordConfirm").value;
    if(next!==confirmPassword){message("#changePasswordMessage","New passwords do not match.",true);return}
    try{
      var data=await api("account.php",{method:"POST",body:{action:"password",currentPassword:current,newPassword:next}});
      auth.csrf=data.csrf||auth.csrf;
      if(data.user)auth.user=data.user;
      $("#currentPassword").value="";$("#newPassword").value="";$("#newPasswordConfirm").value="";
      renderAuth();
      message("#changePasswordMessage","Password updated.");
    }catch(err){message("#changePasswordMessage",err.message,true)}
  }

  async function uploadAvatar(file){
    if(!file)return;
    var form=new FormData();form.append("avatar",file);
    try{
      var data=await api("avatar.php",{method:"POST",body:form});
      auth.user=data.user;renderAuth();
      $("#profileSavedState").hidden=false;
      $("#profileSavedState strong").textContent="Avatar updated";
      $("#profileSavedState small").textContent="Your new avatar is now active.";
      setTimeout(function(){
        $("#profileSavedState").hidden=true;
        $("#profileSavedState strong").textContent="Profile saved";
        $("#profileSavedState small").textContent="Your player details will be used as defaults for new builds.";
      },2200);
    }catch(err){message("#profileMessage",err.message,true)}
    $("#avatarInput").value="";
  }

  async function removeAvatar(){
    try{
      var data=await api("avatar.php",{method:"DELETE"});
      auth.user=data.user;renderAuth();
      message("#profileMessage","Using Gravatar.");
    }catch(err){message("#profileMessage",err.message,true)}
  }

  function openDeleteAccount(){
    message("#deleteAccountMessage","");
    $("#deleteAccountPassword").value="";
    $("#deleteAccountConfirm").value="";
    var dialog=$("#deleteAccountDialog");
    if(dialog&&typeof dialog.showModal==="function"){
      dialog.showModal();
      if(shouldAutoFocus())setTimeout(function(){$("#deleteAccountPassword").focus()},50);
    }
  }

  function closeDeleteAccount(){
    var dialog=$("#deleteAccountDialog");
    if(dialog&&dialog.open)dialog.close();
  }

  async function deleteAccount(event){
    event.preventDefault();
    var password=$("#deleteAccountPassword").value;
    var confirmation=$("#deleteAccountConfirm").value.trim();
    if(confirmation!=="DELETE"){
      message("#deleteAccountMessage","Type DELETE exactly to confirm account deletion.",true);
      return;
    }
    var button=$("#confirmDeleteAccount");
    button.disabled=true;button.textContent="Deleting…";
    try{
      var loginData=await api("login.php",{method:"POST",body:{email:auth.user.email,password:password}});
      auth.csrf=loginData.csrf||auth.csrf;
      await api("delete-account.php",{method:"POST",body:{confirmation:confirmation}});
      closeDeleteAccount();
      auth.user=null;auth.teams=[];auth.decks=[];auth.currentTeamId=null;auth.currentDeckId=null;
      if(window.VCGApp&&window.VCGApp.deleteAccountCleanup)window.VCGApp.deleteAccountCleanup();
      await refreshSession();
      window.VCGApp.navigate("home",{skipBuildGuard:true});
      if(window.VCGApp)window.VCGApp.toast("Account deleted");
    }catch(err){
      message("#deleteAccountMessage",err.message,true);
    }finally{
      button.disabled=false;button.textContent="Delete account permanently";
    }
  }

  async function logout(){
    try{await api("logout.php",{method:"POST"})}catch(e){}
    auth.user=null;auth.teams=[];auth.decks=[];auth.currentTeamId=null;auth.currentDeckId=null;
    await refreshSession();
    setPane("login");
    window.VCGApp.navigate("profile");
    message("#authMessage","Signed out.");
  }

  async function loadTeam(id){
    var team=auth.teams.filter(function(item){return Number(item.id)===Number(id)})[0];
    if(!team)return;
    if(window.VCGApp.importTeam(team.payload)){
      auth.currentTeamId=team.id;
      updateBuilderSaveButton(false);
      renderTeams();
      window.VCGApp.toast(team.name+" loaded");
    }
  }

  async function loadDeck(id){
    var deck=auth.decks.filter(function(item){return Number(item.id)===Number(id)})[0];
    if(!deck||!window.VCGTCG)return;
    if(window.VCGTCG.importDeck(deck.payload,deck.name)){
      auth.currentDeckId=deck.id;
      updateDeckSaveButton(false);
      renderTeams();
      if(window.VCGApp)window.VCGApp.toast(deck.name+" loaded");
    }
  }

  async function shareSavedTeam(id){
    var team=auth.teams.filter(function(item){return Number(item.id)===Number(id)})[0];if(!team)return;
    try{
      var data=await api("team-share.php",{method:"POST",body:{teamId:Number(id)}});
      await loadTeams();
      var url=data.url||"";
      if(navigator.share){
        try{await navigator.share({title:team.name,text:"View my Pokémon team",url:url});return}catch(err){if(err&&err.name==="AbortError")return}
      }
      if(navigator.clipboard&&url){
        await navigator.clipboard.writeText(url);
        message("#teamPageMessage","Share link copied to clipboard.");
      }else{
        prompt("Share this read-only team link",url);
      }
    }catch(err){message("#teamPageMessage",err.message,true)}
  }

  async function revokeTeamShare(id){
    var team=auth.teams.filter(function(item){return Number(item.id)===Number(id)})[0];if(!team)return;
    if(!confirm('Revoke the public link for "'+team.name+'"?'))return;
    try{
      await api("team-share.php?teamId="+encodeURIComponent(id),{method:"DELETE"});
      await loadTeams();
      message("#teamPageMessage","Shared link revoked.");
    }catch(err){message("#teamPageMessage",err.message,true)}
  }

  async function deleteTeam(id){
    var team=auth.teams.filter(function(item){return Number(item.id)===Number(id)})[0];
    if(!team||!confirm('Delete "'+team.name+'"?'))return;
    try{
      await api("teams.php?id="+encodeURIComponent(id),{method:"DELETE"});
      if(Number(auth.currentTeamId)===Number(id))auth.currentTeamId=null;
      await loadTeams();
      updateBuilderSaveButton(false);
      message("#teamPageMessage","Team deleted.");
    }catch(err){message("#teamPageMessage",err.message,true)}
  }

  async function renameTeam(id){
    var team=auth.teams.filter(function(item){return Number(item.id)===Number(id)})[0];if(!team)return;
    var next=prompt("Rename team",team.name);if(next===null)return;next=next.trim();if(!next)return;
    try{
      await api("teams.php",{method:"POST",body:{id:team.id,name:next,game:team.game,payload:team.payload}});
      await loadTeams();message("#teamPageMessage","Team renamed.");
    }catch(err){message("#teamPageMessage",err.message,true)}
  }

  async function duplicateTeam(id){
    var team=auth.teams.filter(function(item){return Number(item.id)===Number(id)})[0];if(!team)return;
    try{
      await api("teams.php",{method:"POST",body:{name:team.name+" copy",game:team.game,payload:team.payload}});
      await loadTeams();message("#teamPageMessage","Team duplicated.");
    }catch(err){message("#teamPageMessage",err.message,true)}
  }

  async function deleteDeck(id){
    var deck=auth.decks.filter(function(item){return Number(item.id)===Number(id)})[0];
    if(!deck||!confirm('Delete "'+deck.name+'"?'))return;
    try{
      await api("decks.php?id="+encodeURIComponent(id),{method:"DELETE"});
      if(Number(auth.currentDeckId)===Number(id))auth.currentDeckId=null;
      await loadTeams();updateDeckSaveButton(false);message("#teamPageMessage","Deck deleted.");
    }catch(err){message("#teamPageMessage",err.message,true)}
  }
  async function renameDeck(id){
    var deck=auth.decks.filter(function(item){return Number(item.id)===Number(id)})[0];if(!deck)return;
    var next=prompt("Rename deck",deck.name);if(next===null)return;next=next.trim();if(!next)return;
    var payload=Object.assign({},deck.payload,{deckName:next});
    try{
      await api("decks.php",{method:"POST",body:{id:deck.id,name:next,format:deck.format,payload:payload}});
      if(Number(auth.currentDeckId)===Number(id)&&window.VCGTCG)window.VCGTCG.setDeckName(next);
      await loadTeams();message("#teamPageMessage","Deck renamed.");
    }catch(err){message("#teamPageMessage",err.message,true)}
  }
  async function duplicateDeck(id){
    var deck=auth.decks.filter(function(item){return Number(item.id)===Number(id)})[0];if(!deck)return;
    var next=deck.name+" copy";
    var payload=Object.assign({},deck.payload,{deckName:next});
    try{
      await api("decks.php",{method:"POST",body:{name:next,format:deck.format,payload:payload}});
      await loadTeams();message("#teamPageMessage","Deck duplicated.");
    }catch(err){message("#teamPageMessage",err.message,true)}
  }

  function wire(){
    $("#accountButton").addEventListener("click",function(){showProfile()});
    $("#saveCloudButton").addEventListener("click",openSaveTeamDialog);
    $("#saveDeckCloudButton").addEventListener("click",openSaveDeckDialog);
    $("#saveDeckForm").addEventListener("submit",saveFromDeck);
    $("#closeSaveDeckDialog").addEventListener("click",closeSaveDeckDialog);
    $("#cancelSaveDeck").addEventListener("click",closeSaveDeckDialog);
    $("#saveDeckDialog").addEventListener("click",function(e){if(e.target===this)closeSaveDeckDialog()});
    $("#saveTeamForm").addEventListener("submit",saveFromBuilder);
    $("#closeSaveTeamDialog").addEventListener("click",closeSaveTeamDialog);
    $("#cancelSaveTeam").addEventListener("click",closeSaveTeamDialog);
    $("#saveTeamDialog").addEventListener("click",function(e){if(e.target===this)closeSaveTeamDialog()});
    $("#manageTeamsButton").addEventListener("click",function(){window.VCGApp.navigate("teams")});
    $("#teamsSignInButton").addEventListener("click",function(){showProfile("login")});

    $$("#profileView [data-auth-pane]").forEach(function(btn){btn.addEventListener("click",function(){setPane(btn.dataset.authPane)})});
    $("#forgotPasswordButton").addEventListener("click",function(){setPane("forgot");$("#forgotEmail").value=$("#loginEmail").value.trim()});
    $("#resendVerificationButton").addEventListener("click",resendVerification);
    $("#registeredResendButton").addEventListener("click",resendVerification);

    $("#loginForm").addEventListener("submit",login);
    $("#registerForm").addEventListener("submit",register);
    $("#forgotForm").addEventListener("submit",forgot);
    $("#resetForm").addEventListener("submit",resetPassword);
    $("#profileForm").addEventListener("submit",saveProfile);
    $("#changeEmailForm").addEventListener("submit",changeEmail);
    $("#changePasswordForm").addEventListener("submit",changePassword);
    ["#profilePlayerName","#profilePlayerId","#profileYearOfBirth"].forEach(function(selector){
      $(selector).addEventListener("input",renderPlayQr);
    });

    $("#uploadAvatarButton").addEventListener("click",function(){$("#avatarInput").click()});
    $("#avatarInput").addEventListener("change",function(e){uploadAvatar(e.target.files&&e.target.files[0])});
    $("#removeAvatarButton").addEventListener("click",removeAvatar);
    $("#logoutButton").addEventListener("click",logout);
    $("#openDeleteAccount").addEventListener("click",openDeleteAccount);
    $("#deleteAccountForm").addEventListener("submit",deleteAccount);
    $("#closeDeleteAccount").addEventListener("click",closeDeleteAccount);
    $("#cancelDeleteAccount").addEventListener("click",closeDeleteAccount);
    $("#deleteAccountDialog").addEventListener("click",function(e){if(e.target===this)closeDeleteAccount()});

    $("#cloudTeamList").addEventListener("click",function(e){
      var load=e.target.closest("[data-load-team]");if(load){loadTeam(load.dataset.loadTeam);return}
      var loadDeckButton=e.target.closest("[data-load-deck]");if(loadDeckButton){loadDeck(loadDeckButton.dataset.loadDeck);return}
      var renameDeckButton=e.target.closest("[data-rename-deck]");if(renameDeckButton){renameDeck(renameDeckButton.dataset.renameDeck);return}
      var duplicateDeckButton=e.target.closest("[data-duplicate-deck]");if(duplicateDeckButton){duplicateDeck(duplicateDeckButton.dataset.duplicateDeck);return}
      var deleteDeckButton=e.target.closest("[data-delete-deck]");if(deleteDeckButton){deleteDeck(deleteDeckButton.dataset.deleteDeck);return}
      var share=e.target.closest("[data-share-team]");if(share){shareSavedTeam(share.dataset.shareTeam);return}
      var revoke=e.target.closest("[data-revoke-share]");if(revoke){revokeTeamShare(revoke.dataset.revokeShare);return}
      var rename=e.target.closest("[data-rename-team]");if(rename){renameTeam(rename.dataset.renameTeam);return}
      var duplicate=e.target.closest("[data-duplicate-team]");if(duplicate){duplicateTeam(duplicate.dataset.duplicateTeam);return}
      var del=e.target.closest("[data-delete-team]");if(del)deleteTeam(del.dataset.deleteTeam);
    });

    document.addEventListener("click",function(e){
      if(e.target.closest("[data-select-game]")){auth.currentTeamId=null;updateBuilderSaveButton(false)}
      if(e.target.closest("[data-select-deck]")){auth.currentDeckId=null;updateDeckSaveButton(false)}
    });
    document.addEventListener("vcg:buildreset",function(){
      auth.currentTeamId=null;
      updateBuilderSaveButton(false);
    });
    document.addEventListener("vcg:buildsaved",function(){updateBuilderSaveButton(false)});
    document.addEventListener("vcg:builddirty",function(){updateBuilderSaveButton(false)});
    document.addEventListener("vcg:deckdirty",function(){updateDeckSaveButton(false)});
    document.addEventListener("vcg:deckreset",function(){auth.currentDeckId=null;updateDeckSaveButton(false)});

    document.addEventListener("vcg:navigate",function(e){
      if(!e.detail)return;
      if(e.detail.target==="teams"){
        renderAuth();
        if(auth.user)loadTeams();
      }
      if(e.detail.target==="profile"&&!auth.user&&auth.resetToken)setPane("reset");
    });
  }

  async function init(){
    wire();
    var params=new URLSearchParams(location.search);
    auth.resetToken=params.get("reset")||"";
    try{
      await refreshSession();
      if(auth.user)loadTeams();
    }catch(err){message("#authMessage","Account service is temporarily unavailable.",true)}

    if(params.get("verified")==="1"){
      history.replaceState({},document.title,"/profile");
      window.VCGApp.navigate("profile",{skipHistory:true});
      setPane("login");message("#authMessage","Email verified. You can sign in.");
    }else if(params.get("verified")==="invalid"){
      history.replaceState({},document.title,"/profile");
      window.VCGApp.navigate("profile",{skipHistory:true});
      setPane("login");message("#authMessage","That verification link is invalid or expired.",true);
    }else if(auth.resetToken){
      window.VCGApp.navigate("profile",{skipHistory:true});setPane("reset");
    }
  }

  document.addEventListener("DOMContentLoaded",init);
})();