# Benchmark

What `npm run bench` measured on `@sveltekit-i18n/typegen` 3.1.1, written by the release that published it. A pull request compares its branch with its base in a comment; this file keeps the figures of each release beside its code.

Node v24.21.0, linux x64; times and heap readings are medians of 11 processes, a time each the median of its rounds, or of one call where an app generates once; a spread leaves out the lowest and the highest quarter of them, rounded down.

## Counts

Calls, config loads, and the checker's types and instantiations: the same on every machine. A pull request that grows one fails its benchmark job unless it carries the `bench-accepted` label.

| Row | Value |
| --- | ---: |
| loader calls, a generation (10,000 keys in namespaces, 2 locales) | 1,000  |
| extractor calls, a generation (10,000 keys in namespaces) | 10,000  |
| addTranslations calls, a generation (10,000 keys in namespaces, 2 locales) | 2  |
| checker types, the artifact of 10,000 flat keys and five t calls | 38,388  |
| checker instantiations, the artifact of 10,000 flat keys and five t calls | 1,560  |
| checker types, the artifact of 10,000 keys in namespaces and five t calls | 39,388  |
| checker instantiations, the artifact of 10,000 keys in namespaces and five t calls | 1,560  |
| checker types, the artifact of 10,000 keys in one namespace and five t calls | 38,390  |
| checker instantiations, the artifact of 10,000 keys in one namespace and five t calls | 1,560  |
| checker types, the artifact of 10,000 nested keys and five t calls | 40,610  |
| checker instantiations, the artifact of 10,000 nested keys and five t calls | 1,560  |
| config loads, a build's generation (1,000 keys in namespaces) | 1  |

## Sizes

Bytes of the artifact: the same on every machine.

| Row | Value |
| --- | ---: |
| the artifact, 1,000 flat keys | 119,583 B |
| the artifact, 10,000 flat keys | 1,242,333 B |
| the artifact, 100,000 flat keys | 12,919,833 B |
| the artifact, 1,000 keys in namespaces | 137,105 B |
| the artifact, 10,000 keys in namespaces | 1,448,407 B |
| the artifact, 100,000 keys in namespaces | 15,294,909 B |
| the artifact, 1,000 keys in one namespace | 131,643 B |
| the artifact, 10,000 keys in one namespace | 1,362,393 B |
| the artifact, 100,000 keys in one namespace | 14,119,893 B |
| the artifact, 1,000 nested keys | 142,799 B |
| the artifact, 10,000 nested keys | 1,526,773 B |
| the artifact, 100,000 nested keys | 16,286,497 B |

## Times

Milliseconds, of one machine at one time: compare them only with figures measured beside them.

| Row | Median | Spread |
| --- | ---: | --- |
| derive, 1,000 flat keys | 6.07 ms | 5.77 ms to 6.35 ms |
| emit, 1,000 flat keys | 5.32 ms | 5.32 ms to 5.36 ms |
| derive, 10,000 flat keys | 60.3 ms | 58.9 ms to 61.2 ms |
| emit, 10,000 flat keys | 61.3 ms | 60.6 ms to 63.1 ms |
| derive, 100,000 flat keys | 777 ms | 762 ms to 785 ms |
| emit, 100,000 flat keys | 665 ms | 655 ms to 669 ms |
| derive, 1,000 keys in namespaces | 4.44 ms | 4.37 ms to 4.52 ms |
| emit, 1,000 keys in namespaces | 5.71 ms | 5.68 ms to 5.73 ms |
| derive, 10,000 keys in namespaces | 52.4 ms | 52 ms to 52.8 ms |
| emit, 10,000 keys in namespaces | 63.8 ms | 62.8 ms to 66.3 ms |
| derive, 100,000 keys in namespaces | 736 ms | 728 ms to 750 ms |
| emit, 100,000 keys in namespaces | 682 ms | 669 ms to 687 ms |
| derive, 1,000 keys in one namespace | 4.28 ms | 4.25 ms to 4.35 ms |
| emit, 1,000 keys in one namespace | 5.53 ms | 5.48 ms to 5.57 ms |
| derive, 10,000 keys in one namespace | 50.3 ms | 50.1 ms to 51.1 ms |
| emit, 10,000 keys in one namespace | 65.1 ms | 60.8 ms to 66.1 ms |
| derive, 100,000 keys in one namespace | 739 ms | 735 ms to 759 ms |
| emit, 100,000 keys in one namespace | 704 ms | 694 ms to 712 ms |
| derive, 1,000 nested keys | 4.04 ms | 3.98 ms to 4.1 ms |
| emit, 1,000 nested keys | 5.53 ms | 5.48 ms to 5.56 ms |
| derive, 10,000 nested keys | 48.4 ms | 48.2 ms to 48.9 ms |
| emit, 10,000 nested keys | 65.5 ms | 64.4 ms to 66.6 ms |
| derive, 100,000 nested keys | 627 ms | 620 ms to 661 ms |
| emit, 100,000 nested keys | 661 ms | 655 ms to 741 ms |
| a build's first generation, on an empty cache, 1,000 keys in namespaces | 847 ms | 827 ms to 866 ms |
| a build's generation, 1,000 keys in namespaces | 634 ms | 629 ms to 646 ms |
| a dev regeneration after a catalogue change, 1,000 keys in namespaces | 372 ms | 361 ms to 375 ms |

## Heap

Bytes of heap retained per dev regeneration, read in a process of their own: they move from process to process and differ from one Node version to another, and a reading near zero, on either side of it, means nothing retained.

| Row | Median | Spread |
| --- | ---: | --- |
| heap retained per dev regeneration, 1,000 keys in namespaces | 865,795 B | 842,282 B to 982,463 B |
