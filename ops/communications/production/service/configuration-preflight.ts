import {configureAcquireCommunications} from '../../../../src/lib/communications-configuration';
import type {SqlPool} from '../../../../communications/packages/storage-postgres/src/webhook-repository';
/** Validate the actual runtime composition without any connection, read, or provider action. */
try {
 if(process.env.NODE_ENV!=='production'||process.env.COMMUNICATIONS_RUNTIME_ENABLED!=='true')throw Error();
 const application=new URL(process.env.DATABASE_URL||''),service=new URL(process.env.COMMUNICATIONS_DATABASE_URL||''),endpoint=new URL(process.env.COMMUNICATIONS_SERVICE_URL||'');
 for(const db of [application,service])if(!['postgres:','postgresql:'].includes(db.protocol)||!db.hostname||db.pathname.length<2)throw Error();
 if(application.hostname===service.hostname&&application.port===service.port&&application.pathname===service.pathname)throw Error();
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error();
 const noConnection:SqlPool={async connect(){throw Error('Configuration preflight never connects');}};
 configureAcquireCommunications({...process.env},{application:noConnection,service:noConnection});
 process.stdout.write('Communications production configuration verified; database readiness is separate.\n');
}catch{
 process.stderr.write('Communications production configuration unavailable; inspect private operator configuration.\n');process.exitCode=1;
}
