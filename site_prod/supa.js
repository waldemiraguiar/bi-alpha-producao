/* Camada de dados Supabase — substitui as funções Netlify (Blobs) pelo estado vivo + Realtime (push).
   Lê/escreve direto nas tabelas (chave anon, RLS); apagar não-separado vai por RPC com PIN.
   Expõe window.SUPA. Se a lib não carregar, .ok=false e o app cai no fallback das funções Netlify. */
(function () {
  const URL = 'https://lrwjcdvporaivxvfuiwt.supabase.co';
  const KEY = 'sb_publishable_fcodHc3AxR_HQ-aduMGzlg_CTBALng8';
  const lib = window.supabase;
  const SB = (lib && lib.createClient) ? lib.createClient(URL, KEY, { realtime: { params: { eventsPerSecond: 5 } } }) : null;
  const arr = r => (r && r.data) ? r.data : [];
  // ⚠️ ARMADILHA (incidente 08/jul): o Supabase/PostgREST CORTA todo select em 1000 linhas.
  // Quando uma tabela passa de 1000, o select('*') puro deixa de trazer as linhas mais novas ->
  // os dados "somem" da tela SEM ERRO (o painel de Triagem travou 6h por isso). REGRA: TODA leitura
  // de tabela que cresce usa pageAll() (busca em blocos de 1000 até acabar). Não usar select('*') solto.
  const pageAll = async (t) => { if (!SB) return []; let all = [], from = 0; for (let g = 0; g < 200; g++) { const { data, error } = await SB.from(t).select('*').range(from, from + 999); if (error) break; const c = data || []; all = all.concat(c); if (c.length < 1000) break; from += 1000; } return all; };

  window.SUPA = {
    ok: !!SB,
    // ---- leitura (TODAS paginadas — armadilha das 1000 linhas) ----
    async loadCli() { if (!SB) return { flags: [], cli_baixas: [] }; const [f, b] = await Promise.all([pageAll('cli_flags'), pageAll('cli_baixas')]); return { flags: f, cli_baixas: b }; },
    async loadSep() { if (!SB) return { marks: [], descartes: [] }; const [m, d] = await Promise.all([pageAll('sep_marks'), pageAll('sep_descartes')]); return { marks: m, descartes: d }; },
    async loadUrg() { if (!SB) return { urgentes: [], baixas: [] }; const [l, b] = await Promise.all([pageAll('urg_lista'), pageAll('urg_baixas')]); return { urgentes: l, baixas: b }; },
    // ---- baixa de EXAME na Produção (PIN admin) ----
    async loadProd() { if (!SB) return []; try { return await pageAll('prod_baixas'); } catch (e) { return []; } },
    // ---- ESPELHO da Histotécnica (app separado, mesmo Supabase) — RPC read-only ----
    async loadAmostras() { if (!SB) return []; try { const { data, error } = await SB.rpc('amostras_espelho'); if (error) return []; return data || []; } catch (e) { return []; } },
    async prodBaixar(itens, nome, senha) { const { error } = await SB.rpc('prod_baixar', { p_itens: itens, p_nome: nome, p_senha: senha }); if (error) throw new Error(error.message || 'login'); },
    async prodUnbaixar(chaves, nome, senha) { const { error } = await SB.rpc('prod_unbaixar', { p_chaves: chaves, p_nome: nome, p_senha: senha }); if (error) throw new Error(error.message || 'login'); },
    // ---- escrita: clientes ----
    upsertFlag(row) { return SB.from('cli_flags').upsert(row); },
    delFlag(cod) { return SB.from('cli_flags').delete().eq('cod', String(cod)); },
    baixaCli(rows) { return SB.from('cli_baixas').upsert(rows); },
    // ---- escrita: triagem ----
    async upsertMark(row) { const { error } = await SB.from('sep_marks').upsert(row); if (error) throw new Error(error.message || 'erro ao salvar'); },
    async updateMark(chave, patch) { const { error } = await SB.from('sep_marks').update(patch).eq('chave', chave); if (error) throw new Error(error.message || 'erro ao salvar'); },
    async delMark(chave) { const { error } = await SB.from('sep_marks').delete().eq('chave', chave); if (error) throw new Error(error.message || 'erro ao apagar'); },
    async admincheck(pin) { try { const { data } = await SB.rpc('sep_admincheck', { p_pin: pin }); return !!data; } catch (e) { return false; } },
    async descartar(itens, pin, por) { const { error } = await SB.rpc('sep_descartar', { p_itens: itens, p_pin: pin, p_por: por || 'admin' }); if (error) throw new Error(error.message || 'PIN'); },
    async undescartar(chaves, pin) { const { error } = await SB.rpc('sep_undescartar', { p_chaves: chaves, p_pin: pin }); if (error) throw new Error(error.message || 'PIN'); },
    // ---- equipe / login de operador (senha conferida no servidor) ----
    async teamNames() { if (!SB) return []; try { const { data, error } = await SB.rpc('sep_team_names'); if (error) return []; return data || []; } catch (e) { return []; } },
    async login(nome, pin) { if (!SB) return { ok: false }; try { const { data, error } = await SB.rpc('sep_login', { p_nome: nome, p_pin: pin }); if (error) return { ok: false }; const r = (data && data[0]) || {}; return { ok: !!r.ok, papel: r.papel || '', podeInsuf: r.pode_insuf === true }; } catch (e) { return { ok: false }; } },
    async teamPerm(pin, nome, on) { const { data, error } = await SB.rpc('sep_team_perm', { p_admin: pin, p_nome: nome, p_on: !!on }); if (error) throw new Error(error.message || 'erro'); return !!data; },
    async register(nome, papel, pin) { if (!SB) return { ok: false, erro: 'sem conexão' }; try { const { data, error } = await SB.rpc('sep_register', { p_nome: nome, p_papel: papel, p_pin: pin }); if (error) return { ok: false, erro: error.message }; const r = (data && data[0]) || {}; return { ok: !!r.ok, erro: r.erro }; } catch (e) { return { ok: false, erro: 'falha' }; } },
    async changePin(nome, oldp, newp) { if (!SB) return { ok: false, erro: 'sem conexão' }; try { const { data, error } = await SB.rpc('sep_change_pin', { p_nome: nome, p_old: oldp, p_new: newp }); if (error) return { ok: false, erro: error.message }; const r = (data && data[0]) || {}; return { ok: !!r.ok, erro: r.erro }; } catch (e) { return { ok: false, erro: 'falha' }; } },
    async teamAdminList(pin) { if (!SB) return null; try { const { data, error } = await SB.rpc('sep_team_admin_list', { p_admin: pin }); if (error) return null; return data || []; } catch (e) { return null; } },
    async teamSave(pin, nome, papel, npin) { const { data, error } = await SB.rpc('sep_team_save', { p_admin: pin, p_nome: nome, p_papel: papel, p_pin: npin }); if (error) throw new Error(error.message || 'erro'); return !!data; },
    async teamRemove(pin, nome) { const { data, error } = await SB.rpc('sep_team_remove', { p_admin: pin, p_nome: nome }); if (error) throw new Error(error.message || 'erro'); return !!data; },
    // ---- escrita: urgentes ----
    upsertUrg(table, row) { return SB.from(table).upsert(row); },
    delUrg(table, registro) { return SB.from(table).delete().eq('registro', String(registro)); },
    // ---- Realtime (push) ----
    subscribe(tables, cb) {
      if (!SB) return null;
      const ch = SB.channel('rt_' + tables.join('_') + '_' + Math.floor(performance.now()));
      tables.forEach(t => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, cb));
      ch.subscribe();
      return ch;
    },
    unsub(ch) { try { if (SB && ch) SB.removeChannel(ch); } catch (e) {} },
  };
})();
