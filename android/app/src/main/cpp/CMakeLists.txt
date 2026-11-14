# The native parts: the app itself (LG-C, as libmain.so over SDL2) and the small piece that
# starts nodejs-mobile's Node with the local server.
cmake_minimum_required(VERSION 3.22.1)
project(stremcompat C CXX)

add_subdirectory(${LGC_DIR}/third_party/sdl-src/SDL2-2.30.9 sdl EXCLUDE_FROM_ALL)
file(GLOB APP_SOURCES ${LGC_DIR}/src/*.c ${LGC_DIR}/src/core/*.c ${LGC_DIR}/src/screens/*.c)
add_library(main SHARED ${APP_SOURCES} ${LGC_DIR}/src/platform/android.c ${LGC_DIR}/src/platform/android_player.c)
set_target_properties(main PROPERTIES C_STANDARD 11)
target_include_directories(main PRIVATE ${LGC_DIR}/src ${LGC_DIR}/src/core ${LGC_DIR}/src/platform ${LGC_DIR}/third_party/stb)
target_link_libraries(main SDL2::SDL2 GLESv2 log m)

add_library(native-lib SHARED native-lib.cpp)
target_include_directories(native-lib PRIVATE ${NODE_DIR}/include/node)
add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES IMPORTED_LOCATION ${NODE_DIR}/bin/${ANDROID_ABI}/libnode.so)
find_library(log-lib log)
target_link_libraries(native-lib libnode ${log-lib})
