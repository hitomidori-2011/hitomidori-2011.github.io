(() => {
  'use strict';
  const panel = document.getElementById('app-panel');
  const status = document.getElementById('offline-status');
  const installButton = document.getElementById('app-install');
  const instructions = document.getElementById('app-instructions');
  if (!panel || !status || !installButton || !instructions) return;

  const standalone = window.matchMedia('(display-mode: standalone)');
  const isInstalled = () => standalone.matches || window.navigator.standalone === true;
  let installPrompt = null;
  let registration = null;
  let checking = false;
  let saved = false;

  function showStatus(message) {
    status.hidden = false;
    status.textContent = message;
  }

  function showSavedStatus() {
    showStatus(navigator.onLine
      ? 'この端末に保存しました。オフラインでも閲覧できます。'
      : 'オフラインです。この端末に保存した内容を閲覧できます。');
  }

  function updateInstallUI() {
    installButton.hidden = isInstalled() || !installPrompt;
    instructions.hidden = isInstalled();
  }
  updateInstallUI();
  standalone.addEventListener('change', updateInstallUI);

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    updateInstallUI();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installButton.hidden = true;
    instructions.hidden = true;
  });
  installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    installButton.hidden = true;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') instructions.hidden = true;
    } catch (_) {
      instructions.open = true;
    }
  });

  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    showStatus('この環境ではオフライン保存を利用できません。オンラインでご覧ください。');
    return;
  }

  function askWorker(worker, type) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        reject(new Error('Offline check timed out'));
      }, 20000);
      channel.port1.onmessage = event => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(event.data);
      };
      worker.postMessage({type}, [channel.port2]);
    });
  }

  async function refreshOfflineStatus() {
    const worker = navigator.serviceWorker.controller || (registration && registration.active);
    if (!worker || checking) return;
    checking = true;
    try {
      let result = await askWorker(worker, 'GET_OFFLINE_STATUS');
      if (!result.ready && navigator.onLine) {
        showStatus('オフラインで見られるように、この端末へ保存しています…');
        result = await askWorker(worker, 'SAVE_OFFLINE');
      }
      saved = Boolean(result.ready);
      if (saved) showSavedStatus();
      else showStatus('オフライン保存は未完了です。通信できる状態で、ページを再読み込みしてください。');
    } catch (_) {
      saved = false;
      showStatus('オフライン保存を確認できませんでした。通信できる状態で、ページを再読み込みしてください。');
    } finally {
      checking = false;
    }
  }

  navigator.serviceWorker.addEventListener('controllerchange', refreshOfflineStatus);
  window.addEventListener('online', refreshOfflineStatus);
  window.addEventListener('offline', () => {
    if (saved) showSavedStatus();
    else refreshOfflineStatus();
  });
  window.addEventListener('pageshow', () => {
    if (registration) refreshOfflineStatus();
  });

  showStatus('オフラインで見られるように、この端末へ保存しています…');
  navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'})
    .then(result => {
      registration = result;
      const installing = result.installing;
      if (installing) {
        installing.addEventListener('statechange', () => {
          if (installing.state === 'redundant' && !saved) {
            showStatus('オフライン保存が完了しませんでした。通信できる状態で、ページを再読み込みしてください。');
          }
        });
      }
      return navigator.serviceWorker.ready;
    })
    .then(result => {
      registration = result;
      return refreshOfflineStatus();
    })
    .catch(() => {
      showStatus('オフライン保存を利用できませんでした。オンラインでご覧ください。');
    });
})();
