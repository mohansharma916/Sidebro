#!/usr/bin/env bash
# Downloads the free system design library described in RESOURCES.md into ./library
set -euo pipefail

LIB="$(cd "$(dirname "$0")" && pwd)/library"
mkdir -p "$LIB/papers"
cd "$LIB"

clone() { # repo dir
  rm -rf "$2"
  git clone --depth 1 -q "https://github.com/$1.git" "$2"
  rm -rf "$2/.git"
}

clone donnemartin/system-design-primer system-design-primer
clone karanpratapsingh/system-design karanpratapsingh-system-design
clone ByteByteGoHq/system-design-101 bytebytego-system-design-101
clone ashishps1/awesome-system-design-resources awesome-system-design-resources
clone binhnguyennus/awesome-scalability awesome-scalability

curl -fsSL -o aws-well-architected-framework.pdf https://docs.aws.amazon.com/pdfs/wellarchitected/latest/framework/wellarchitected-framework.pdf

G=https://static.googleusercontent.com/media/research.google.com/en//archive
curl -fsSL -o papers/dynamo-amazon-2007.pdf https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf
curl -fsSL -o papers/gfs-google-2003.pdf "$G/gfs-sosp2003.pdf"
curl -fsSL -o papers/bigtable-google-2006.pdf "$G/bigtable-osdi06.pdf"
curl -fsSL -o papers/mapreduce-google-2004.pdf "$G/mapreduce-osdi04.pdf"
curl -fsSL -o papers/spanner-google-2012.pdf "$G/spanner-osdi2012.pdf"
curl -fsSL -o papers/kafka-linkedin-2011.pdf https://notes.stephenholiday.com/Kafka.pdf

echo "Library ready in $LIB"
