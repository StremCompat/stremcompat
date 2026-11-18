#import "NodeRunner.h"

#include <NodeMobile/NodeMobile.h>
#include <stdlib.h>
#include <string.h>

@implementation NodeRunner

/* Node wants its arguments one after the other in a single block of memory */
+ (int)startWithArguments:(NSArray<NSString *> *)arguments {
  int count = (int)arguments.count;
  size_t total = 0;
  for (NSString *a in arguments) total += strlen(a.UTF8String) + 1;
  char *block = (char *)malloc(total), **argv = (char **)malloc(sizeof(char *) * (size_t)count), *at = block;
  for (int i = 0; i < count; i++) {
    const char *s = arguments[i].UTF8String;
    size_t n = strlen(s) + 1;
    memcpy(at, s, n);
    argv[i] = at;
    at += n;
  }
  return node_start(count, argv);
}

@end
