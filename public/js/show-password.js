/* Show / hide for password boxes on the admin pages: a small "Show" button inside every password field (also the ones
   drawn later, like the Edit account window). It only changes what the box displays while it is open; nothing is stored or sent. */
(function () {
    function add(input) {
        if (input.dataset.showpw) return;
        input.dataset.showpw = '1';
        const wrap = document.createElement('span');
        wrap.style.cssText = 'position:relative;display:block;width:100%;';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        input.style.paddingRight = '64px';
        input.style.boxSizing = 'border-box';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Show';
        btn.setAttribute('aria-label', 'Show password');
        btn.setAttribute('aria-pressed', 'false');
        btn.style.cssText = 'position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:#e2e8f0;color:#0f172a;border-radius:6px;padding:4px 9px;font-size:12px;font-weight:700;cursor:pointer;line-height:1.2;';
        btn.addEventListener('click', function () {
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.textContent = show ? 'Hide' : 'Show';
            btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
            btn.setAttribute('aria-pressed', String(show));
            input.focus();
        });
        wrap.appendChild(btn);
    }
    function scan(root) { (root || document).querySelectorAll('input[type="password"]').forEach(add); }
    scan();
    new MutationObserver(function (muts) {
        for (const m of muts) m.addedNodes.forEach(function (n) {
            if (n.nodeType !== 1) return;
            if (n.matches && n.matches('input[type="password"]')) add(n); else scan(n);
        });
    }).observe(document.documentElement, { childList: true, subtree: true });
})();
