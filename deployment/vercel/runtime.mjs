export async function ensureDocker(sandbox) {
  const groups=await sandbox.runCommand({cmd:'sh',args:['-c','set -e; mkdir -p /sys/fs/cgroup/twodb-host; for pid in $(cat /sys/fs/cgroup/cgroup.procs); do echo "$pid" > /sys/fs/cgroup/twodb-host/cgroup.procs 2>/dev/null || true; done; echo "+cpu +memory +pids" > /sys/fs/cgroup/cgroup.subtree_control; mkdir -p /sys/fs/cgroup/twodb-containers'],sudo:true});
  if(groups.exitCode!==0)throw Error('Hosted cgroup delegation failed');
  const current=await sandbox.runCommand({cmd:'docker',args:['info'],sudo:true});
  if(current.exitCode!==0)await sandbox.runCommand({cmd:'dockerd',args:['--exec-opt','native.cgroupdriver=cgroupfs','--cgroup-parent=/twodb-containers'],sudo:true,detached:true});
  const ready=await sandbox.runCommand({cmd:'sh',args:['-c','for i in $(seq 1 30); do if docker info >/dev/null 2>&1; then chmod 666 /var/run/docker.sock; exit 0; fi; sleep 1; done; exit 1'],sudo:true});
  if(ready.exitCode!==0)throw Error('Hosted Docker startup failed');
}
