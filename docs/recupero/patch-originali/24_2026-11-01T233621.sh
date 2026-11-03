# 2026-11-01T23:36:21.538Z  esito: ok
# output: 'test-stati-ricetta:   FAIL - E5. Schede: rifiutata se contiene Ricette protette (nessuna cascata); eliminabile   FAIL - M1. Unisci: Ricette Validate, Attive e bozze trasferite con stesso id, stato, for   FAIL - M3. Unisci con errore della funzione nel database (es. blocco scaduto): Ricette t   FAIL '
B=/tmp/claude-0/-home-user-Khub/72a60e49-aca5-5514-bb9d-e5a4330113b3/scratchpad/chat2.bak; cp api/chat.js $B && python3 - <<'EOF'
p='api/chat.js'; s=open(p).read()
s=s.replace("if (table === 'recipes' && body.soloSeVuota === true) {","if (false) {")
open(p,'w').write(s)
EOF
for t in test-stati-ricetta test-supabase-secret-key; do echo "$t: $(HTTPS_PROXY=http://127.0.0.1:9 node scripts/$t.js 2>&1 | grep -E '^  FAIL|passed' | cut -c1-90 | tr '\n' ' ')"; done; cp $B api/chat.js; git diff --stat api/chat.js
