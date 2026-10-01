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
      if(body&&!(body instanceof FormData)){
        headers["Content-Type"]="application/json";
        body=JSON.stringify(body);
      }
    }

    var response=await fetch("/api/"+path,{
      method:method,
      headers:headers,
      body:body,
      credentials:"same-origin",
      cache:"no-store"
    });
    var data={};
    try{data=await response.json()}catch(e){data={error:"The server returned an invalid response."}}

    if(response.status===419&&!retry){
      await refreshSession();
      return api(path,options,true);
    }
    if(!response.ok){
      var err=new Error(data.error||"Request failed.");
      err.status=response.status;err.code=data.code||"";err.data=data;
      throw err;
    }
    return data;
  }

  function setPane(name){
    ["login","register","forgot","reset"].forEach(function(p){
      var form=$("#"+p+"Form");if(form)form.hidden=p!==name;
    });
    $$(".account-tabs [data-auth-pane]").forEach(function(btn){btn.classList.toggle("is-selected",btn.dataset.authPane===name)});
    $(".account-tabs").hidden=name==="forgot"||name==="reset";
    $("#resendVerificationButton").hidden=true;
    message("#authMessage","");
  }

  function openAccount(pane){
    $("#accountBackdrop").hidden=false;
    document.body.style.overflow="hidden";
    if(!auth.user)setPane(pane||"login");
    else loadTeams();
  }

  function closeAccount(){
    $("#accountBackdrop").hidden=true;
    document.body.style.overflow="";
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
    var user=auth.user;
    if(!user)return;
    $("#profileEmail").textContent=user.email;
    $("#profileAvatar").src=user.avatarUrl;
    $("#profilePlayerName").value=user.playerName||"";
    $("#profileTrainerName").value=user.trainerName||"";
    $("#profilePlayerId").value=user.playerId||"";
    $("#profileYearOfBirth").value=user.yearOfBirth||"";
    $("#removeAvatarButton").hidden=user.avatarMode!=="custom";
  }

  function renderAuth(){
    renderAccountButton();
    $("#accountGuest").hidden=!!auth.user;
    $("#accountUser").hidden=!auth.user;
    if(auth.user){
      renderProfile();
      if(window.VCGApp)window.VCGApp.applyProfileDefaults(auth.user,false);
    }else{
      auth.teams=[];auth.currentTeamId=null;
    }
  }

  function teamImages(team){
    var mons=team.payload&&Array.isArray(team.payload.team)?team.payload.team.filter(Boolean).slice(0,6):[];
    return mons.map(function(mon){return mon.image?'<img src="'+esc(mon.image)+'" alt="">':''}).join("");
  }

  function renderTeams(){
    var list=$("#cloudTeamList");
    if(!auth.teams.length){
      list.innerHTML='<div class="cloud-empty">No saved teams yet.</div>';
      return;
    }
    list.innerHTML=auth.teams.map(function(team){
      var selected=Number(auth.currentTeamId)===Number(team.id);
      return '<article class="cloud-team'+(selected?' is-current':'')+'" data-team-id="'+team.id+'">'+
        '<button type="button" class="cloud-team-open" data-load-team="'+team.id+'">'+
          '<div class="cloud-team-images">'+teamImages(team)+'</div>'+
          '<div><strong>'+esc(team.name)+'</strong><small>'+esc(team.game.toUpperCase())+' · '+esc(team.updatedAt)+'</small></div>'+
        '</button>'+
        '<button type="button" class="cloud-team-delete" data-delete-team="'+team.id+'" aria-label="Delete '+esc(team.name)+'">×</button>'+
      '</article>';
    }).join("");
  }

  async function loadTeams(){
    if(!auth.user)return;
    try{
      var data=await api("teams.php");
      auth.teams=data.teams||[];
      renderTeams();
    }catch(err){
      message("#profileMessage",err.message,true);
    }
  }

  async function saveCurrentTeam(){
    if(!auth.user){openAccount("login");return}
    if(!window.VCGApp)return;
    var payload=window.VCGApp.exportTeam();
    var name=$("#cloudTeamName").value.trim()||window.VCGApp.defaultTeamName();
    try{
      var data=await api("teams.php",{method:"POST",body:{
        id:auth.currentTeamId||undefined,
        name:name,
        game:payload.game,
        payload:payload
      }});
      auth.currentTeamId=data.team.id;
      $("#cloudTeamName").value=data.team.name;
      await loadTeams();
      message("#profileMessage","Team saved.");
      window.VCGApp.toast("Team saved to your account");
    }catch(err){
      message("#profileMessage",err.message,true);
    }
  }

  async function login(event){
    event.preventDefault();
    message("#authMessage","");
    try{
      var data=await api("login.php",{method:"POST",body:{
        email:$("#loginEmail").value.trim(),
        password:$("#loginPassword").value
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
    if(password!==$("#registerPasswordConfirm").value){
      message("#authMessage","Passwords do not match.",true);return;
    }
    try{
      var data=await api("register.php",{method:"POST",body:{
        email:$("#registerEmail").value.trim(),password:password
      }});
      message("#authMessage",data.message||"Check your email.");
      $("#loginEmail").value=$("#registerEmail").value.trim();
    }catch(err){message("#authMessage",err.message,true)}
  }

  async function resendVerification(){
    var email=$("#loginEmail").value.trim()||$("#registerEmail").value.trim();
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
    if(password!==$("#resetPasswordConfirm").value){
      message("#authMessage","Passwords do not match.",true);return;
    }
    try{
      var data=await api("reset-password.php",{method:"POST",body:{token:auth.resetToken,password:password}});
      history.replaceState({},document.title,location.pathname);
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
      auth.user=data.user;
      renderAuth();
      if(window.VCGApp)window.VCGApp.applyProfileDefaults(auth.user,true);
      message("#profileMessage","Profile saved.");
    }catch(err){message("#profileMessage",err.message,true)}
  }

  async function uploadAvatar(file){
    if(!file)return;
    var form=new FormData();form.append("avatar",file);
    try{
      var data=await api("avatar.php",{method:"POST",body:form});
      auth.user=data.user;renderAuth();
      message("#profileMessage","Avatar updated.");
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
    message("#authMessage","Signed out.");
  }

  async function loadTeam(id){
    var team=auth.teams.filter(function(item){return Number(item.id)===Number(id)})[0];
    if(!team||!window.VCGApp)return;
    if(window.VCGApp.importTeam(team.payload)){
      auth.currentTeamId=team.id;
      $("#cloudTeamName").value=team.name;
      renderTeams();closeAccount();
      window.VCGApp.toast(team.name+" loaded");
    }
  }

  async function deleteTeam(id){
    var team=auth.teams.filter(function(item){return Number(item.id)===Number(id)})[0];
    if(!team||!confirm('Delete "'+team.name+'"?'))return;
    try{
      await api("teams.php?id="+encodeURIComponent(id),{method:"DELETE"});
      if(Number(auth.currentTeamId)===Number(id)){auth.currentTeamId=null;$("#cloudTeamName").value=""}
      await loadTeams();
      message("#profileMessage","Team deleted.");
    }catch(err){message("#profileMessage",err.message,true)}
  }

  function wire(){
    $("#accountButton").addEventListener("click",function(){openAccount()});
    $("#saveCloudButton").addEventListener("click",function(){if(auth.user){openAccount();setTimeout(function(){$("#cloudTeamName").focus()},100)}else openAccount("login")});
    $("#closeAccountButton").addEventListener("click",closeAccount);

    $$("[data-auth-pane]").forEach(function(btn){btn.addEventListener("click",function(){setPane(btn.dataset.authPane)})});
    $("#forgotPasswordButton").addEventListener("click",function(){setPane("forgot");$("#forgotEmail").value=$("#loginEmail").value.trim()});
    $("#resendVerificationButton").addEventListener("click",resendVerification);

    $("#loginForm").addEventListener("submit",login);
    $("#registerForm").addEventListener("submit",register);
    $("#forgotForm").addEventListener("submit",forgot);
    $("#resetForm").addEventListener("submit",resetPassword);
    $("#profileForm").addEventListener("submit",saveProfile);

    $("#uploadAvatarButton").addEventListener("click",function(){$("#avatarInput").click()});
    $("#avatarInput").addEventListener("change",function(e){uploadAvatar(e.target.files&&e.target.files[0])});
    $("#removeAvatarButton").addEventListener("click",removeAvatar);
    $("#logoutButton").addEventListener("click",logout);
    $("#saveCurrentCloudTeam").addEventListener("click",saveCurrentTeam);

    $("#cloudTeamList").addEventListener("click",function(e){
      var load=e.target.closest("[data-load-team]");
      if(load){loadTeam(load.dataset.loadTeam);return}
      var del=e.target.closest("[data-delete-team]");
      if(del)deleteTeam(del.dataset.deleteTeam);
    });

    document.addEventListener("keydown",function(e){
      if(e.key==="Escape"&&!$("#accountBackdrop").hidden)closeAccount();
    });
  }

  async function init(){
    wire();
    var params=new URLSearchParams(location.search);
    auth.resetToken=params.get("reset")||"";
    try{
      await refreshSession();
      if(auth.user)loadTeams();
    }catch(err){
      message("#authMessage","Account service is temporarily unavailable.",true);
    }

    if(params.get("verified")==="1"){
      history.replaceState({},document.title,location.pathname);
      openAccount("login");message("#authMessage","Email verified. You can sign in.");
    }else if(params.get("verified")==="invalid"){
      history.replaceState({},document.title,location.pathname);
      openAccount("login");message("#authMessage","That verification link is invalid or expired.",true);
    }else if(auth.resetToken){
      openAccount("reset");setPane("reset");
    }
  }

  document.addEventListener("DOMContentLoaded",init);
})();