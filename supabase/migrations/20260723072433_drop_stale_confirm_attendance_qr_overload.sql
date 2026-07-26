-- create or replace ne remplace une fonction que si sa signature (types de
-- parametres) est identique. confirm_attendance_qr(text) [0015] et
-- confirm_attendance_qr(text, text default null) [20260723010000] ont des
-- signatures differentes : les deux versions coexistaient, rendant tout
-- appel positionnel a un seul argument ambigu ("is not unique"). Seule la
-- version a deux parametres (avec secours PIN) doit rester.
drop function if exists public.confirm_attendance_qr(text);

revoke execute on function public.confirm_attendance_qr(text, text) from public, anon;
grant execute on function public.confirm_attendance_qr(text, text) to authenticated;
