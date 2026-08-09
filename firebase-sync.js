  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
  import {
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
  } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
  import {
    getFirestore, doc, setDoc, getDoc, serverTimestamp
  } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

  const firebaseConfig = {
    apiKey: "AIzaSyCW4lg5DeqRJS6cnZO9vRTgO-FIo63Ktfg",
    authDomain: "my-plan-mini-app.firebaseapp.com",
    projectId: "my-plan-mini-app",
    storageBucket: "my-plan-mini-app.firebasestorage.app",
    messagingSenderId: "245314920603",
    appId: "1:245314920603:web:3d3ebfdbbc5a291825663e"
  };

  let auth = null, db = null, currentUser = null, cloudReady = false;
  let signInInProgress = false;

  function setSignInButtonsDisabled(disabled){
    ['signInBtnTop', 'signInBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if(btn) btn.disabled = disabled;
    });
  }

  function looksConfigured(cfg){
    return cfg.apiKey && !cfg.apiKey.startsWith("YOUR_");
  }

  if(looksConfigured(firebaseConfig)){
    try{
      const app = initializeApp(firebaseConfig);
      auth = getAuth(app);
      db = getFirestore(app);
      cloudReady = true;
    }catch(e){
      console.warn("Firebase failed to initialize:", e);
    }
  }

  if(!cloudReady){
    const btn = document.getElementById('signInBtn');
    if(btn){ btn.title = "Cloud sync isn't set up yet — see setup instructions."; }
    if(window.setCloudStatus) window.setCloudStatus("Cloud sync not set up", "off");
  }

  const provider = new GoogleAuthProvider();
  // Always show the account chooser instead of silently reusing whatever
  // Google session is already active in the browser — reduces the risk
  // of someone signing into this app just because a Google account
  // happens to already be logged in on a shared/unlocked device.
  provider.setCustomParameters({ prompt: "select_account" });

  window.signIn = async function(){
    if(!cloudReady){
      alert("Cloud sync isn't configured yet. Add your Firebase project keys in the code (see the setup instructions).");
      return;
    }
    // Both the top-bar and sidebar buttons call this same function. If
    // a click is already opening a popup, ignore further clicks instead
    // of firing a second signInWithPopup — two concurrent calls cause
    // Firebase to cancel the first with "auth/cancelled-popup-request",
    // which is exactly the spurious error dialog seen before the real
    // account chooser shows up.
    if(signInInProgress) return;
    signInInProgress = true;
    setSignInButtonsDisabled(true);
    try{
      await signInWithPopup(auth, provider);
    }catch(e){
      // Not real failures — just the user backing out or closing the
      // popup themselves. Nothing to alert them about.
      if(e.code !== 'auth/cancelled-popup-request' && e.code !== 'auth/popup-closed-by-user'){
        alert("Sign-in failed: " + e.message);
      }
    }finally{
      signInInProgress = false;
      setSignInButtonsDisabled(false);
    }
  };

  window.signOutUser = async function(){
    if(!cloudReady) return;
    await signOut(auth);
  };

  window.getSignedInEmail = function(){
    return currentUser ? (currentUser.email || "") : "";
  };

  let saveTimer = null;
  window.queueCloudSave = function(){
    if(!cloudReady || !currentUser) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doCloudSave, 800);
  };

  async function doCloudSave(){
    if(!cloudReady || !currentUser) return;
    try{
      const state = window.getBoardState();
      await setDoc(doc(db, "planboards", currentUser.uid), {
        plans: state.plans,
        activeIndex: state.activeIndex,
        settings: state.settings,
        updatedAt: serverTimestamp()
      });
      window.setCloudStatus("Synced to cloud " + new Date().toLocaleTimeString(), "on");
    }catch(e){
      console.warn("Cloud save failed:", e);
      window.setCloudStatus("Cloud save failed — check your connection.", "warn");
    }
  }

  async function loadCloudData(uid){
    try{
      const snap = await getDoc(doc(db, "planboards", uid));
      if(snap.exists()){
        const data = snap.data();
        if(Array.isArray(data.plans) && data.plans.length){
          window.setBoardState({ plans: data.plans, activeIndex: data.activeIndex, settings: data.settings });
        }
        window.setCloudStatus("Loaded from cloud", "on");
      } else {
        await doCloudSave();
        window.setCloudStatus("Cloud sync on — starting from your local plans", "on");
      }
    }catch(e){
      console.warn("Cloud load failed:", e);
      window.setCloudStatus("Could not load cloud data — showing local copy.", "warn");
    }
  }

  if(cloudReady){
    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      window.updateAuthUI(user);
      if(user){
        loadCloudData(user.uid);
      } else {
        window.setCloudStatus("Local only (not signed in)", "off");
      }
    });
  }
