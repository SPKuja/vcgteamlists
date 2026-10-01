(function(){
  "use strict";

  var auth={csrf:"",user:null,teams:[],currentTeamId:null,resetToken:""};

  function $(s,root){return (root||document).querySelector(s)}
  function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}
  function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]})}

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
    $("#profileAvatar").src=auth.user.avatarUrl;
    $("#profilePlayerName").value=auth.user.playerName||"";
    $("#profileTrainerName").value=auth.user.trainerName||"";
    $("#profilePlayerId").value=auth.user.playerId||"";
    $("#profileYearOfBirth").value=auth.user.yearOfBirth||"";
    $("#removeAvatarButton").hidden=auth.user.avatarMode!=="custom";
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
      auth.teams=[];auth.currentTeamId=null;renderTeams();
    }
    updateBuilderSaveButton(false);
  }

  function friendlyGame(game){
    return {champions:"Pokémon Champions",sv:"Scarlet / Violet",swsh:"Sword / Shield",custom:"Custom / Other"}[game]||game;
  }

  function teamImages(team){
    var mons=team.payload&&Array.isArray(team.payload.team)?team.payload.team.filter(Boolean).slice(0,6):[];
    return mons.map(function(mon){return mon.image?'<img src="'+esc(mon.image)+'" alt="">':''}).join("");
  }

  function renderTeams(){
    var list=$("#cloudTeamList");if(!list)return;
    var count=$("#savedTeamCount");
    if(count)count.textContent=auth.teams.length+" "+(auth.teams.length===1?"team":"teams");
    if(!auth.user){list.innerHTML="";return}
    if(!auth.teams.length){
      list.innerHTML='<div class="cloud-empty"><strong>No saved teams yet</strong><span>Build a team, then use Save to account in the team builder.</span></div>';
      return;
    }
    list.innerHTML=auth.teams.map(function(team){
      var selected=Number(auth.currentTeamId)===Number(team.id);
      var mons=team.payload&&Array.isArray(team.payload.team)?team.payload.team.filter(Boolean):[];
      return '<article class="cloud-team'+(selected?' is-current':'')+'" data-team-id="'+team.id+'">'+
        '<button type="button" class="cloud-team-open" data-load-team="'+team.id+'">'+
          '<div class="cloud-team-images">'+teamImages(team)+'</div>'+
          '<div class="cloud-team-copy"><strong>'+esc(team.name)+'</strong><small>'+esc(friendlyGame(team.game))+' · '+mons.length+'/6 Pokémon</small></div>'+
        '</button>'+
        '<div class="cloud-team-actions">'+
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
      var data=await api("teams.php");
      auth.teams=data.teams||[];
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
    if(!auth.user){btn.textContent="Save to account";return}
    if(savedNow){btn.textContent="✓ Saved";return}
    btn.textContent=auth.currentTeamId?"Update saved team":"Save to account";
  }

  async function saveFromBuilder(){
    if(!auth.user){showProfile("login");return}
    var payload=window.VCGApp.exportTeam();
    var existing=auth.teams.filter(function(t){return Number(t.id)===Number(auth.currentTeamId)})[0];
    var name=existing?existing.name:suggestedTeamName(payload);
    try{
      var data=await api("teams.php",{method:"POST",body:{
        id:auth.currentTeamId||undefined,name:name,game:payload.game,payload:payload
      }});
      auth.currentTeamId=data.team.id;
      if(window.VCGApp)window.VCGApp.markSaved();
      await loadTeams();
      updateBuilderSaveButton(true);
      window.VCGApp.toast(existing?"Saved team updated":"Team saved to your account");
      setTimeout(function(){updateBuilderSaveButton(false)},1600);
    }catch(err){window.VCGApp.toast(err.message)}
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
      await api("register.php",{method:"POST",body:{email:$("#registerEmail").value.trim(),password:password}});
      var email=$("#registerEmail").value.trim();
      $("#loginEmail").value=email;$("#registeredEmail").textContent=email;
      $("#registerPassword").value="";$("#registerPasswordConfirm").value="";
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

  async function logout(){
    try{await api("logout.php",{method:"POST"})}catch(e){}
    auth.user=null;auth.teams=[];auth.currentTeamId=null;
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

  function wire(){
    $("#accountButton").addEventListener("click",function(){showProfile()});
    $("#saveCloudButton").addEventListener("click",saveFromBuilder);
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

    $("#uploadAvatarButton").addEventListener("click",function(){$("#avatarInput").click()});
    $("#avatarInput").addEventListener("change",function(e){uploadAvatar(e.target.files&&e.target.files[0])});
    $("#removeAvatarButton").addEventListener("click",removeAvatar);
    $("#logoutButton").addEventListener("click",logout);

    $("#cloudTeamList").addEventListener("click",function(e){
      var load=e.target.closest("[data-load-team]");if(load){loadTeam(load.dataset.loadTeam);return}
      var rename=e.target.closest("[data-rename-team]");if(rename){renameTeam(rename.dataset.renameTeam);return}
      var duplicate=e.target.closest("[data-duplicate-team]");if(duplicate){duplicateTeam(duplicate.dataset.duplicateTeam);return}
      var del=e.target.closest("[data-delete-team]");if(del)deleteTeam(del.dataset.deleteTeam);
    });

    document.addEventListener("click",function(e){
      if(e.target.closest("[data-select-game]")){auth.currentTeamId=null;updateBuilderSaveButton(false)}
    });
    document.addEventListener("vcg:buildreset",function(){
      auth.currentTeamId=null;
      updateBuilderSaveButton(false);
    });
    document.addEventListener("vcg:buildsaved",function(){updateBuilderSaveButton(true)});
    document.addEventListener("vcg:builddirty",function(){updateBuilderSaveButton(false)});

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