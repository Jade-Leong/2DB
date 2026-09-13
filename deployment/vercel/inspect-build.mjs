import {Sandbox} from '@vercel/sandbox';
const sandbox=await Sandbox.get({name:'twodb-host-runtime'});
try {
 const groups=await sandbox.runCommand({cmd:'sh',args:['-c','set -e; mkdir -p /sys/fs/cgroup/twodb-host; for pid in $(cat /sys/fs/cgroup/cgroup.procs); do echo "$pid" > /sys/fs/cgroup/twodb-host/cgroup.procs 2>/dev/null || true; done; echo "+cpu +memory +pids" > /sys/fs/cgroup/cgroup.subtree_control; mkdir -p /sys/fs/cgroup/twodb-containers; cat /sys/fs/cgroup/twodb-containers/cgroup.type'],sudo:true});
 console.log('Cgroup preparation:',groups.exitCode,await groups.stdout(),await groups.stderr());
 const daemon=await sandbox.runCommand({cmd:'dockerd',args:['--exec-opt','native.cgroupdriver=cgroupfs','--cgroup-parent=/twodb-containers'],sudo:true,detached:true});
 const result=await sandbox.runCommand({cmd:'sh',args:['-c','for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done; docker run --rm --network none --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 2g --cpus 2 --tmpfs /tmp:rw,nosuid,nodev,size=512m,uid=1000,gid=1000 twodb-agent:12ac3d46b73dad78173a node /opt/runtime/probe.mjs'],sudo:true});
 console.log(await result.stdout());console.log(await result.stderr());
 if(result.exitCode!==0){const finished=await daemon.wait({signal:AbortSignal.timeout(3000)});console.log('Daemon exit',finished.exitCode);console.log((await finished.stderr()).slice(-5000));}
}finally{await sandbox.stop();}
