-- Read-only catalog inspection. No business rows, secret values or mutations.
SELECT jsonb_build_object(
 'database',current_database(),
 'serverVersion',current_setting('server_version'),
 'readOnly',current_setting('transaction_read_only'),
 'migration', (SELECT jsonb_agg(to_jsonb(m)) FROM schema_migrations m),
 'tables', (SELECT jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),
   'rlsEnabled',c.relrowsecurity,'rlsForced',c.relforcerowsecurity,
   'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
   'constraints',(SELECT jsonb_agg(jsonb_build_object('name',con.conname,'type',con.contype,'definition',pg_get_constraintdef(con.oid),'validated',con.convalidated,'deferrable',con.condeferrable,'initiallyDeferred',con.condeferred)) FROM pg_constraint con WHERE con.conrelid=c.oid),
   'indexes',(SELECT jsonb_agg(jsonb_build_object('name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique)) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid),
   'policies',(SELECT jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'using',pg_get_expr(p.polqual,p.polrelid),'withCheck',pg_get_expr(p.polwithcheck,p.polrelid))) FROM pg_policy p WHERE p.polrelid=c.oid)
 ) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p'))
);
