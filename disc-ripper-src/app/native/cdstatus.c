/* Prints the tray state of an optical drive: open, closed (disc in), empty (tray closed, no disc), notready or unknown. */
#include <fcntl.h>
#include <limits.h>
#include <linux/cdrom.h>
#include <stdio.h>
#include <sys/ioctl.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc < 2) return 2;
  int fd = open(argv[1], O_RDONLY | O_NONBLOCK);
  if (fd < 0) { puts("unknown"); return 1; }
  int r = ioctl(fd, CDROM_DRIVE_STATUS, CDSL_CURRENT);
  close(fd);
  puts(r == CDS_TRAY_OPEN ? "open" : r == CDS_DISC_OK ? "closed" : r == CDS_NO_DISC ? "empty" : r == CDS_DRIVE_NOT_READY ? "notready" : "unknown");
  return 0;
}
