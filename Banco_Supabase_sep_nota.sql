-- ============================================================
-- 🧾 Separação (Triagem/Produção) — coluna NOTA (observação livre)
-- Problema (Dudu 19/10): na cito/histopatologia, a QUANTIDADE de potes/fragmentos
-- (campo azul "Veio em:") era gravada na MESMA coluna `obs` da observação, então a
-- quantidade "descia" pro campo de observação e um sobrescrevia o outro.
-- Correção: a observação livre passa a ter a coluna própria `nota`; a quantidade
-- continua no `obs` (forma), sem colisão. Dado existente é preservado.
-- Rodar 1x no SQL Editor (projeto lrwjcdvporaivxvfuiwt). Idempotente.
-- ============================================================
alter table public.sep_marks add column if not exists nota text;
