export const supportStyles = `
:root {
  --ground:#EEF2F5;--surface:#FFFFFF;--s2:#F6F9FB;--s3:#EAF0F4;
  --border:#DBE3EA;--bstrong:#C2CED8;
  --ink:#0A141D;--ink2:#33465A;--ink3:#6C8092;
  --accent:#0A7EA4;--accent-ink:#075D7A;--accent-soft:#DFF0F6;
  --ai:#5B54E8;--ai-soft:#EAE9FD;
  --ok:#12855B;--ok-soft:#E0F2E9;
  --warn:#A57400;--warn-soft:#F8EFD9;
  --crit:#CE3226;--crit-soft:#FBE7E5;
  --violet:#7B3FA0;--violet-soft:#F1E5F7;
  --sh1: 0 1px 2px rgba(10, 20, 29, 0.05);
  --sh3: 0 2px 4px rgba(10, 20, 29, 0.08), 0 24px 56px -12px rgba(10, 20, 29, 0.30);
  --ui:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mo:ui-monospace,"SF Mono",SFMono-Regular,"Cascadia Mono","Segoe UI Mono",Menlo,Consolas,monospace;
  --ed:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
}

:root[data-theme="dark"], .dark {
  --ground:#05090D;--surface:#0F1821;--s2:#141E28;--s3:#1A2530;
  --border:#202D39;--bstrong:#324351;
  --ink:#E6EDF3;--ink2:#A4B5C3;--ink3:#6F8397;
  --accent:#289AC6;--accent-ink:#7FCDE8;--accent-soft:#0B2A38;
  --ai:#7A72F2;--ai-soft:#191838;
  --ok:#25A878;--ok-soft:#0C2A1F;
  --warn:#BC8A2A;--warn-soft:#2B2110;
  --crit:#E2564A;--crit-soft:#31150F;
  --violet:#B18CD9;--violet-soft:#2A1B38;
  --sh1: 0 1px 2px rgba(0, 0, 0, 0.35);
  --sh3: 0 2px 4px rgba(0, 0, 0, 0.45), 0 24px 56px -12px rgba(0, 0, 0, 0.60);
}

.support-workspace * { box-sizing: border-box; }
.support-workspace { min-height: 100vh; background: var(--ground); color: var(--ink); font-family: var(--ui); font-size: 13.3px; line-height: 1.5; }
.support-workspace button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
.support-workspace input, .support-workspace select, .support-workspace textarea { font: inherit; color: inherit; }
.support-workspace a { color: var(--accent); text-decoration: none; }
.support-workspace .mo { font-family: var(--mo); font-variant-numeric: tabular-nums; }
.support-workspace .topbar { display: flex; align-items: center; gap: 14px; padding: 10px 20px; background: var(--s2); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 40; }
.support-workspace .brand { display: flex; align-items: center; gap: 9px; }
.support-workspace .bmark { width: 26px; height: 26px; border-radius: 7px; background: var(--accent); color: white; display: grid; place-items: center; font-size: 13px; font-weight: 700; flex: none; font-family: var(--ed); }
.support-workspace .bname { font-size: 13.5px; font-weight: 650; letter-spacing: -0.01em; line-height: 1.1; }
.support-workspace .bsub { font-family: var(--mo); font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink3); }
.support-workspace .gsearch { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 7px 12px; width: 340px; color: var(--ink3); margin-left: 10px; }
.support-workspace .gsearch input { border: 0; outline: 0; background: none; flex: 1; font-size: 12.5px; color: var(--ink); }
.support-workspace .topbar .sp { margin-left: auto; }
.support-workspace .iconbtn { position: relative; width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; color: var(--ink2); border: 1px solid transparent; }
.support-workspace .iconbtn:hover { background: var(--s3); border-color: var(--border); }
.support-workspace .badge-dot { position: absolute; top: 5px; right: 6px; width: 7px; height: 7px; border-radius: 50%; background: var(--crit); border: 1.5px solid var(--s2); }
.support-workspace .demoswitch { display: flex; gap: 3px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 3px; }
.support-workspace .demoswitch button { padding: 5px 10px; border-radius: 6px; font-size: 10.8px; font-weight: 650; color: var(--ink3); }
.support-workspace .demoswitch button.on { background: var(--ink); color: var(--surface); }
.support-workspace .demoswitch .lbl { font-family: var(--mo); font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink3); padding: 0 6px; align-self: center; }
.support-workspace .who { display: flex; align-items: center; gap: 8px; position: relative; }
.support-workspace .avatar { width: 27px; height: 27px; border-radius: 50%; background: var(--violet-soft); color: var(--violet); display: grid; place-items: center; font-size: 11px; font-weight: 700; flex: none; }
.support-workspace .who b { font-size: 12px; display: block; }
.support-workspace .who span { font-size: 10px; color: var(--ink3); }
.support-workspace .dropdown { position: absolute; top: calc(100% + 8px); right: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--sh3); min-width: 230px; z-index: 60; overflow: hidden; }
.support-workspace .dropdown .dhd { padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 11.5px; color: var(--ink3); }
.support-workspace .dropdown .ditem { display: flex; gap: 9px; align-items: flex-start; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.support-workspace .dropdown .ditem:last-child { border-bottom: 0; }
.support-workspace .dropdown .ditem:hover { background: var(--s2); }
.support-workspace .dropdown .ditem b { font-size: 12px; display: block; }
.support-workspace .dropdown .ditem span { font-size: 10.8px; color: var(--ink3); }
.support-workspace .dropdown button.ditem { width: 100%; text-align: left; }
.support-workspace .shell { display: grid; grid-template-columns: 216px 1fr; min-height: calc(100vh - 54px); }
.support-workspace .rail { background: var(--s2); border-right: 1px solid var(--border); padding: 14px 0; display: flex; flex-direction: column; position: sticky; top: 54px; height: calc(100vh - 54px); overflow-y: auto; }
.support-workspace .railitem { display: flex; align-items: center; gap: 11px; width: 100%; padding: 9px 18px; font-size: 12.6px; font-weight: 560; color: var(--ink2); border-left: 2px solid transparent; text-align: left; }
.support-workspace .railitem .ico { width: 17px; text-align: center; flex: none; font-size: 13px; }
.support-workspace .railitem:hover { background: var(--s3); }
.support-workspace .railitem.on { background: var(--surface); color: var(--ink); border-left: 2px solid var(--accent); font-weight: 650; }
.support-workspace .railitem .cnt { margin-left: auto; font-family: var(--mo); font-size: 9.5px; color: var(--ink3); background: var(--s3); border-radius: 9px; padding: 1px 6px; }
.support-workspace .railitem.locked { opacity: 0.5; }
.support-workspace .railitem .lk { margin-left: auto; font-size: 11px; }
.support-workspace main { padding: 22px 26px 60px; max-width: 1320px; }
.support-workspace .crumbs { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink3); margin-bottom: 10px; }
.support-workspace .crumbs a { color: var(--ink3); }
.support-workspace .crumbs .cur { color: var(--ink); }
.support-workspace .pagehd { margin-bottom: 18px; display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.support-workspace .pagehd h1 { font-family: var(--ed); font-weight: 400; font-size: 23px; letter-spacing: -0.015em; margin: 0 0 3px; }
.support-workspace .pagehd p { margin: 0; color: var(--ink3); font-size: 12.4px; }
.support-workspace .pagehd .sp { margin-left: auto; display: flex; gap: 8px; }
.support-workspace .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 11px; margin-bottom: 20px; }
.support-workspace .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 11px; padding: 13px 15px; box-shadow: var(--sh1); }
.support-workspace .stat .lbl { font-family: var(--mo); font-size: 9.5px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink3); }
.support-workspace .stat .val { font-size: 22px; font-weight: 650; margin-top: 5px; letter-spacing: -0.01em; }
.support-workspace .stat .sub { font-size: 10.8px; color: var(--ink3); margin-top: 2px; }
.support-workspace .stat.ok .val { color: var(--ok); }
.support-workspace .stat.warn .val { color: var(--warn); }
.support-workspace .stat.crit .val { color: var(--crit); }
.support-workspace .stat.ai .val { color: var(--ai); }
.support-workspace .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--sh1); margin-bottom: 16px; overflow: hidden; }
.support-workspace .card .hd { display: flex; align-items: center; gap: 10px; padding: 13px 17px; border-bottom: 1px solid var(--border); }
.support-workspace .card .hd h2 { font-size: 13.6px; font-weight: 650; margin: 0; }
.support-workspace .card .hd .sp { margin-left: auto; display: flex; gap: 8px; }
.support-workspace .card .bd { padding: 4px 0; }
.support-workspace .card .bd.pad { padding: 15px 17px; }
.support-workspace table { width: 100%; border-collapse: collapse; }
.support-workspace th { text-align: left; font-family: var(--mo); font-size: 9.6px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink3); padding: 9px 17px; border-bottom: 1px solid var(--border); white-space: nowrap; }
.support-workspace td { padding: 10px 17px; border-bottom: 1px solid var(--border); font-size: 12.4px; vertical-align: middle; }
.support-workspace tr:last-child td { border-bottom: 0; }
.support-workspace tr.clickable:hover td { background: var(--s2); cursor: pointer; }
.support-workspace .nm { font-weight: 650; }
.support-workspace .muted { color: var(--ink3); }
.support-workspace .row { display: flex; align-items: center; gap: 12px; padding: 12px 17px; border-bottom: 1px solid var(--border); }
.support-workspace .row:last-child { border-bottom: 0; }
.support-workspace .row .tx { flex: 1; min-width: 0; }
.support-workspace .row .tx b { font-size: 12.4px; display: block; }
.support-workspace .row .tx span { font-size: 10.8px; color: var(--ink3); }
.support-workspace .row .sp { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.support-workspace .btn { border: 1px solid var(--border); background: var(--surface); border-radius: 7px; padding: 6px 12px; font-size: 11.3px; font-weight: 600; color: var(--ink2); }
.support-workspace .btn:hover { border-color: var(--bstrong); }
.support-workspace .btn.pri { background: var(--accent); border-color: var(--accent); color: white; }
.support-workspace .btn.sm { padding: 4px 9px; font-size: 10.6px; }
.support-workspace .pill { display: inline-flex; align-items: center; gap: 5px; font-size: 10.4px; font-weight: 650; padding: 3px 9px; border-radius: 20px; letter-spacing: 0.01em; white-space: nowrap; }
.support-workspace .pill.ok { background: var(--ok-soft); color: var(--ok); }
.support-workspace .pill.warn { background: var(--warn-soft); color: var(--warn); }
.support-workspace .pill.crit { background: var(--crit-soft); color: var(--crit); }
.support-workspace .pill.ai { background: var(--ai-soft); color: var(--ai); }
.support-workspace .pill.nu { background: var(--s3); color: var(--ink3); }
.support-workspace .pill.accent { background: var(--accent-soft); color: var(--accent-ink); }
.support-workspace .pill.violet { background: var(--violet-soft); color: var(--violet); }
.support-workspace .dot-b::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor; display: inline-block; }
.support-workspace .filterbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.support-workspace .fselect { border: 1px solid var(--border); background: var(--surface); border-radius: 7px; padding: 6px 10px; font-size: 11.5px; color: var(--ink2); }
.support-workspace .searchin { display: flex; align-items: center; gap: 7px; border: 1px solid var(--border); background: var(--surface); border-radius: 7px; padding: 6px 11px; min-width: 220px; }
.support-workspace .searchin input { border: 0; outline: 0; background: none; flex: 1; font-size: 12px; }
.support-workspace .chip { border: 1px solid var(--border); background: var(--surface); border-radius: 20px; padding: 5px 12px; font-size: 11px; font-weight: 600; color: var(--ink2); }
.support-workspace .chip.on { background: var(--ink); color: var(--surface); border-color: var(--ink); }
.support-workspace .notice { display: flex; gap: 10px; align-items: flex-start; background: var(--ai-soft); border: 1px solid var(--ai); border-radius: 10px; padding: 11px 14px; margin-bottom: 15px; font-size: 11.8px; color: var(--ink2); }
.support-workspace .notice b { color: var(--ai); }
.support-workspace .split { display: grid; grid-template-columns: 1fr 320px; gap: 16px; }
.support-workspace .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); padding: 0 17px; }
.support-workspace .tab { padding: 10px 13px; font-size: 12px; font-weight: 650; color: var(--ink3); border-bottom: 2px solid transparent; }
.support-workspace .tab.on { color: var(--ink); border-bottom-color: var(--accent); }
.support-workspace .thread { padding: 14px 17px; }
.support-workspace .msg { display: flex; gap: 10px; margin-bottom: 14px; }
.support-workspace .msg .av { width: 26px; height: 26px; border-radius: 50%; background: var(--s3); color: var(--ink2); display: grid; place-items: center; font-size: 10px; font-weight: 700; flex: none; }
.support-workspace .msg .bub { flex: 1; }
.support-workspace .msg .bub .hd2 { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.support-workspace .msg .bub .hd2 b { font-size: 12.2px; }
.support-workspace .msg .bub .hd2 span { font-size: 10.5px; color: var(--ink3); }
.support-workspace .msg .bub .txt { background: var(--s2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 13px; font-size: 12.3px; color: var(--ink2); }
.support-workspace .msg.support .bub .txt { background: var(--accent-soft); border-color: var(--accent-soft); }
.support-workspace .composer { border-top: 1px solid var(--border); padding: 14px 17px; }
.support-workspace .composer textarea { width: 100%; min-height: 76px; border: 1px solid var(--border); border-radius: 9px; padding: 10px 12px; font-size: 12.4px; resize: vertical; }
.support-workspace .composer .bar { display: flex; align-items: center; gap: 8px; margin-top: 9px; }
.support-workspace .visitoggle { display: flex; gap: 2px; background: var(--s3); border-radius: 7px; padding: 2px; }
.support-workspace .visitoggle button { padding: 5px 10px; border-radius: 5px; font-size: 10.8px; font-weight: 650; color: var(--ink3); }
.support-workspace .visitoggle button.on { background: var(--surface); color: var(--ink); box-shadow: var(--sh1); }
.support-workspace .sidepane .block { border-bottom: 1px solid var(--border); padding: 13px 17px; }
.support-workspace .sidepane .block:last-child { border-bottom: 0; }
.support-workspace .sidepane .block h3 { font-size: 10.8px; text-transform: uppercase; letter-spacing: 0.05em; font-family: var(--mo); color: var(--ink3); margin: 0 0 9px; }
.support-workspace .kv { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; margin-bottom: 6px; }
.support-workspace .kv span:first-child { color: var(--ink3); }
.support-workspace .kv span:last-child { font-weight: 600; text-align: right; }
.support-workspace .masked { font-family: var(--mo); letter-spacing: 0.02em; }
.support-workspace .kbcat { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 18px; }
.support-workspace .kbcatcard { background: var(--surface); border: 1px solid var(--border); border-radius: 11px; padding: 15px; cursor: pointer; }
.support-workspace .kbcatcard:hover { border-color: var(--bstrong); }
.support-workspace .kbcatcard .n { font-size: 20px; margin-bottom: 6px; }
.support-workspace .kbcatcard b { font-size: 12.6px; display: block; margin-bottom: 2px; }
.support-workspace .kbcatcard span { font-size: 10.8px; color: var(--ink3); }
.support-workspace .deniedwrap { padding: 60px 20px; text-align: center; }
.support-workspace .deniedwrap .ic { font-size: 34px; margin-bottom: 12px; }
.support-workspace .deniedwrap b { display: block; font-size: 15px; margin-bottom: 6px; }
.support-workspace .deniedwrap p { color: var(--ink3); font-size: 12.4px; max-width: 380px; margin: 0 auto; }
.support-workspace .field { margin-bottom: 13px; }
.support-workspace .field label { display: block; font-size: 11px; color: var(--ink3); margin-bottom: 5px; font-weight: 600; }
.support-workspace .field input, .support-workspace .field select, .support-workspace .field textarea { width: 100%; border: 1px solid var(--border); border-radius: 7px; padding: 8px 11px; font-size: 12.6px; background: var(--surface); color: var(--ink); }
.support-workspace .field textarea { min-height: 70px; resize: vertical; }
@media (max-width: 980px) {
  .support-workspace .shell { grid-template-columns: 64px 1fr; }
  .support-workspace .railitem span:not(.ico):not(.cnt) { display: none; }
}
@media (max-width: 1050px) {
  .support-workspace .split { grid-template-columns: 1fr; }
}
`;
