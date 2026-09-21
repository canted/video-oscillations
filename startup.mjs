// Report module loading and synchronous startup failures on the page, where
// phone users can see them without opening a developer console.
import('./app.js?v=a758c3b36e31').catch(error => {
  console.error('Video Oscillations could not start:', error);
  const message = document.getElementById('msg');
  message.style.display = '';
  message.textContent = 'Unable to start. Reload to try again.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'reload';
  reload.className = 'startup-reload';
  reload.addEventListener('click', () => location.reload());
  message.appendChild(reload);
});
