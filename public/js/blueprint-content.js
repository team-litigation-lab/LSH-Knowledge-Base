/* 🧭 The Knowledge Base Blueprint's slides (lsh-blueprint.js draws them and makes the PDFs; it's the same file on
   every LSH platform). TRAINEE: for VAs (reviewers too). TRAINER: for admins only.
   A slide is { icon, title, points: [...], where, tip }. Change the wording here; the page and the PDFs are made
   from it each time, stamped with the deployed version. README → 🧭 Blueprint. */
(function () {
  'use strict';
  const TRAINEE = {
    sub: 'How to find, use and add to the LSH VA community library',
    slides: [
      { icon: '📚', title: 'What the Knowledge Base is', points: [
          'The LSH VA community library: official SOPs, training videos, guides and know-how from the whole community.',
          'Entries sit in collections, one per program or role: Foundational Training, Reception, Intake, Case Management, EA / PA and more.',
          'Inside a collection, entries are grouped by section.',
          'Anyone in the community can add to it; reviewers keep it accurate.'],
        where: 'Top bar → Library.',
        tip: 'Look for ✓ Official: those entries are the firm\'s approved way of doing it.' },
      { icon: '🔑', title: 'Signing in', points: [
          'Enter your name, your batch and the team access code your trainer gives you.',
          'Your browser stays signed in for 30 days.',
          'If the code changes, everyone signs in again with the new one.'],
        where: 'The sign-in screen.',
        tip: 'Use the same name and batch as on your training platform, so your contributions are credited to you.' },
      { icon: '🔍', title: 'Finding what you need', points: [
          'Search covers titles, summaries, content, tags and sections, and the text inside uploaded PDFs, Word, Excel and PowerPoint files.',
          'Filter by type, Official only, or videos.',
          'Browse a collection by its sections, or start from Featured.'],
        where: 'The search box at the top · Library.',
        tip: 'Search a phrase from the document itself: the text inside files is searchable too.' },
      { icon: '🎬', title: 'Videos and files', points: [
          'Training videos play in the page, and you can skip to any point.',
          'PDFs open in the page, and everything can be downloaded.',
          'Videos lists every training video in one place.'],
        where: 'Top bar → Videos · an entry\'s files.',
        tip: 'Mark an entry Helpful when it saved you time: it helps others find it.' },
      { icon: '➕', title: 'Adding to the library', points: [
          '+ Add to the library: a title, a summary, the content, the collection and section, and tags.',
          'Upload PDFs, Word, Excel and PowerPoint files, images, audio and training videos, up to 5 GB each.',
          'Big files go up in parts and retry by themselves if the connection drops.',
          'New entries wait for a reviewer before everyone can see them.'],
        where: 'Top bar → + Add to the library.',
        tip: 'Never upload real client information: use the training cases only.' },
      { icon: '✏️', title: 'Editing and suggesting', points: [
          'Every save adds a version: nothing is ever overwritten.',
          'Your edit to someone else\'s entry is a suggestion; the current version stays up until a reviewer approves it.',
          'The history shows every version and compares any of them with the current one.'],
        where: 'An entry → Edit · History.',
        tip: 'Say what you changed in a short note, so the reviewer can approve it quickly.' },
      { icon: '💬', title: 'Replies, votes and your contributions', points: [
          'Reply to an entry with your own experience from the team. Replies appear after a reviewer approves them.',
          'Helpful votes and view counts show which entries the community uses most.',
          'My contributions lists everything you added, suggested or replied; Contributors lists the whole community.'],
        where: 'An entry → Reply · Top bar → My contributions · Contributors.',
        tip: 'A good reply says what you did, what happened and what you\'d do next time.' },
      { icon: '✅', title: 'Reviewers', points: [
          'Trusted VAs can be made reviewers by an admin.',
          'Reviewers see the Review queue: new entries, suggested edits and replies waiting for approval.',
          'Only admins mark entries Official, change settings or delete for good.'],
        where: 'Top bar → Review (reviewers).',
        tip: 'Approve only what you\'d trust a new VA to follow word for word.' }
    ]
  };
  const TRAINER = {
    sub: 'Running the Knowledge Base: the admin side',
    slides: [
      { icon: '🔑', title: 'Signing in as an admin', points: [
          'Admins sign in with their LSH Training Portal admin username and password.',
          'Admin in the top bar has the settings, the reviewers, the import and the backup.',
          'The portal\'s site lock (Master Control) closes this site too.'],
        where: 'The sign-in screen → Admin · Top bar → Admin.',
        tip: 'Your admin sign-in is the same as the Training Portal\'s: no separate account to keep.' },
      { icon: '🗝', title: 'The team access code', points: [
          'VAs sign in with their name, batch and the team access code.',
          'It\'s the same code as the portal\'s Knowledge Base page, stored in the same place.',
          'Changing the code signs every VA out; they sign in again with the new one.'],
        where: 'Admin → the access code.',
        tip: 'Change the code when a batch ends, so former trainees no longer get in.' },
      { icon: '✅', title: 'The review queue', points: [
          'New entries, suggested edits and replies from VAs wait in Review.',
          'Approve to make a version live, or send it back.',
          'A suggested edit leaves the current version up until it\'s approved.'],
        where: 'Top bar → Review.',
        tip: 'Clear the queue daily: a VA who waits a week stops contributing.' },
      { icon: '👥', title: 'Reviewers', points: [
          'Make trusted VAs reviewers, so you aren\'t the only one approving.',
          'Reviewers approve entries, edits and replies; they can\'t mark Official, change settings or delete for good.',
          'Revoke a reviewer at any time.'],
        where: 'Admin → Reviewers.',
        tip: 'Pick one reviewer per program, who knows that program\'s SOPs.' },
      { icon: '⭐', title: 'Official and Featured', points: [
          '✓ Official marks an entry as the firm\'s approved way of doing it. Only admins can set it.',
          'Featured entries show first in the Library.',
          'VAs can filter by Official only.'],
        where: 'An entry → Official · Feature.',
        tip: 'Mark the current SOP for each process Official, and only one per process.' },
      { icon: '🕘', title: 'History, restore, archive and delete', points: [
          'Every save is a version; compare any version with the current one.',
          'Restore any earlier version, even after a bad edit was approved.',
          'Removing an entry archives it; unarchive brings it back.',
          'Only an admin can delete for good, by typing DELETE.'],
        where: 'An entry → History · Archive · Admin → archived entries.',
        tip: 'Archive instead of deleting: it keeps the history if you need it again.' },
      { icon: '🗂', title: 'Collections and sections', points: [
          'Collections, one per program or role, and the sections inside them.',
          'Edit a collection\'s name and blurb so VAs know what belongs there.'],
        where: 'Admin → Collections.',
        tip: 'Keep sections in the order the program teaches them.' },
      { icon: '💾', title: 'Import and backup', points: [
          'Import the old Knowledge Base\'s posts from the Training Portal into the library.',
          'Download a backup: every entry and every version, as JSON.',
          'Uploaded files are kept in the training file storage; nothing is lost when an entry changes.'],
        where: 'Admin → Import · Download a backup.',
        tip: 'Download a backup before any big clean-up.' }
    ]
  };

  // The deployed version: the page's ETag (it changes with every deploy), shortened.
  let ver = null;
  function version() {
    if (ver) return ver;
    ver = fetch('/', { method: 'HEAD', cache: 'no-store' })
      .then(r => { const t = (r.headers.get('etag') || '').replace(/^W\//, '').replace(/[^A-Za-z0-9]/g, ''); return t ? 'deploy ' + t.slice(0, 8) : ''; })
      .catch(() => '');
    return ver;
  }
  window.LSH_BLUEPRINT = {
    product: 'Knowledge Base',
    site: 'LSH Knowledge Base',
    file: 'LSH_Knowledge_Base',
    logo: '/lsh-logo-dark.png',
    trainee: TRAINEE,
    trainer: TRAINER,
    // admins get both decks; everyone signed in (VAs and reviewers) the VA deck
    role: () => { const s = window.KB_SESSION && window.KB_SESSION(); return !s || !s.unlocked ? null : s.admin ? 'trainer' : 'trainee'; },
    version,
    // in the top bar, before Sign out (app.js draws the bar again on every page and calls LSHBlueprint.refresh())
    mount: (html) => { const out = document.getElementById('signout'); if (out) out.insertAdjacentHTML('beforebegin', html); }
  };
})();
