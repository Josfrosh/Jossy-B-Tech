(function () {
  var API = 'https://jossybmarketingagent.lovable.app/api/public';
  try {
    var k = 'jb_v', v = localStorage.getItem(k);
    if (!v) { v = Math.random().toString(36).slice(2); localStorage.setItem(k, v); }
    var u = new URLSearchParams(location.search);
    fetch(API + '/track', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: location.pathname, referrer: document.referrer, utm_source: u.get('utm_source') || '', visitor: v })
    }).catch(function () {});
  } catch (e) {}
  function addForm() {
    if (document.getElementById('jb-survey')) return;
    var s = document.createElement('section');
    s.id = 'jb-survey';
    s.style.cssText = 'display:flex;justify-content:center;padding:40px 20px';
    s.innerHTML =
      '<form action="' + API + '/subscribe" method="POST" style="display:grid;gap:12px;width:100%;max-width:440px;background:#0f2a44;color:#f3f4f6;padding:24px;border-radius:12px;font-family:sans-serif">' +
      '<strong style="font-size:1.1rem;color:#c9971c">Which digital solution do you need most?</strong>' +
      '<p style="font-size:.85rem;color:#cbd5e1;margin:0 0 8px">Tell us what you are working toward and get our free guide.</p>' +
      '<label><input type="radio" name="need" value="Help getting a job"> Help getting a job</label>' +
      '<label><input type="radio" name="need" value="Learning a new skill to earn"> Learning a new skill to earn</label>' +
      '<label><input type="radio" name="need" value="Automating my business"> Automating my business</label>' +
      '<label><input type="radio" name="need" value="A website or app"> A website or app</label>' +
      '<textarea name="note" rows="3" maxlength="1000" placeholder="Or tell us in your own words what you need..." style="padding:10px;border-radius:6px;border:0"></textarea>' +
      '<input type="hidden" name="list_id" value="8f10d8af-0519-4a47-9ab0-315d58c4a2a5">' +
      '<input type="text" name="website" style="display:none" tabindex="-1" autocomplete="off">' +
      '<input type="text" name="first_name" placeholder="Your name" style="padding:10px;border-radius:6px;border:0">' +
      '<input type="email" name="email" required placeholder="Email address for guide delivery" style="padding:10px;border-radius:6px;border:0">' +
      '<button type="submit" style="padding:12px;background:#c9971c;color:#111;border:0;border-radius:6px;font-weight:700;cursor:pointer">Send my answer</button>' +
      '</form>';
    var f = document.querySelector('footer');
    f ? f.parentNode.insertBefore(s, f) : document.body.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addForm); else addForm();
  setTimeout(addForm, 2000);
})();
