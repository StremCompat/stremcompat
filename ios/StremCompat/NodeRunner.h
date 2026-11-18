#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// nodejs-mobile's Node, run on the calling thread until it stops.
@interface NodeRunner : NSObject
+ (int)startWithArguments:(NSArray<NSString *> *)arguments;
@end

NS_ASSUME_NONNULL_END
