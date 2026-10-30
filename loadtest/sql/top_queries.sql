-- Slowest/heaviest statements since the last reset (pg_stat_statements). Reset before a run with:
--   select extensions.pg_stat_statements_reset();
select calls, round(total_exec_time::numeric, 0) as total_ms, round(mean_exec_time::numeric, 2) as mean_ms,
       round(max_exec_time::numeric, 1) as max_ms, rows, shared_blks_read as disk_blks,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query
from extensions.pg_stat_statements
where dbid = (select oid from pg_database where datname = current_database())
order by total_exec_time desc limit 20;
