# Notices

Studio Notebook's own code is MIT licensed (see `LICENSE`). The word tools are
built from the following sources. The data files are generated when the Docker
image is built (`app/scripts/build-data.js`); only the King James text and the
short figures-of-speech list are stored in this repository.

| Data | Used for | License |
| --- | --- | --- |
| [CMU Pronouncing Dictionary](http://www.speech.cs.cmu.edu/cgi-bin/cmudict) (via the `cmu-pronouncing-dictionary` package) | Rhymes, syllable counts, alliteration | BSD-style license, Copyright (c) Carnegie Mellon University. Package: ISC |
| [WordNet 3.1](https://wordnet.princeton.edu/) (via the `wordnet-db` package) | Meanings, synonyms, opposites, phrases | WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved. Used under the WordNet License, reproduced below |
| [Moby Thesaurus II](https://en.wikipedia.org/wiki/Moby_Project) by Grady Ward | Word families, phrases | Public domain |
| [SCOWL](http://wordlist.aspell.net/) word lists (via the `wordlist-english` package) | Ranking common words first | Copyright 2000-2016 by Kevin Atkinson, permissive license reproduced below |
| King James Version | Bible search | Public domain |
| Syne, Inter, Geist Mono typefaces | The interface | SIL Open Font License 1.1 |

The figures-of-speech list in `app/data-src/figures.json` was put together for
this app from common sayings and is released with the code.

## WordNet License

WordNet Release 3.1. This software and database is being provided to you, the
LICENSEE, by Princeton University under the following license. By obtaining,
using and/or copying this software and database, you agree that you have read,
understood, and will comply with these terms and conditions:

Permission to use, copy, modify and distribute this software and database and
its documentation for any purpose and without fee or royalty is hereby
granted, provided that you agree to comply with the following copyright notice
and statements, including the disclaimer, and that the same appear on ALL
copies of the software, database and documentation, including modifications
that you make for internal use or for distribution.

WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved.

THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY MAKES
NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT
NOT LIMITATION, PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF
MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE
LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY
PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.

The name of Princeton University or Princeton may not be used in advertising
or publicity pertaining to distribution of the software and/or database. Title
to copyright in this software, database and any associated documentation shall
at all times remain with Princeton University and LICENSEE agrees to preserve
same.

## SCOWL

Copyright 2000-2016 by Kevin Atkinson

Permission to use, copy, modify, distribute and sell these word lists, the
associated scripts, the output created from the scripts, and its documentation
for any purpose is hereby granted without fee, provided that the above
copyright notice appears in all copies and that both that copyright notice and
this permission notice appear in supporting documentation. Kevin Atkinson makes
no representations about the suitability of this array for any purpose. It is
provided "as is" without express or implied warranty.

## CMU Pronouncing Dictionary

Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer. The contents of this file
   are deemed to be source code.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

This work was supported in part by funding from the Defense Advanced Research
Projects Agency, the Office of Naval Research and the National Science
Foundation of the United States of America, and by member companies of the
Carnegie Mellon Sphinx Speech Consortium. We acknowledge the contributions of
many volunteers to the expansion and improvement of this dictionary.

THIS SOFTWARE IS PROVIDED BY CARNEGIE MELLON UNIVERSITY "AS IS" AND ANY
EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL CARNEGIE MELLON UNIVERSITY NOR ITS EMPLOYEES BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY
OF SUCH DAMAGE.
