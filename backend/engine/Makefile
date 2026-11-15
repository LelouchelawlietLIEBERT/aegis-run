CXX ?= g++
CXXFLAGS ?= -std=c++20 -O3 -Wall -Wextra -Iinclude
LDFLAGS ?= -lseccomp

SRC := $(wildcard src/*.cpp)
OBJ := $(SRC:.cpp=.o)
TARGET := ../bin/aegis-run

all: $(TARGET)

$(TARGET): $(OBJ)
	@mkdir -p ../bin
	$(CXX) $(CXXFLAGS) $(OBJ) -o $(TARGET) $(LDFLAGS)

src/%.o: src/%.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

clean:
	rm -f $(OBJ) $(TARGET)

.PHONY: all clean
