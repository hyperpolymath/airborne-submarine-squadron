\version "2.25.32"

\header {
  title = "Glint Current"
  subtitle = "Normal Flight"
  composer = "Airborne Submarine Squadron (sketch)"
}

lead = \relative c' {
  \key d \minor
  \time 4/4
  \tempo 4 = 112
  d8 f g a g f e d | d f g a c bes a g |
  d8 f g a g f e d | d f g a c bes a g |
}

pad = \relative c' {
  \key d \minor
  \time 4/4
  d2 f | bes2 d | g2 bes | a2 a |
  d2 f | bes2 d | g2 bes | a2 a |
}

bass = \relative c {
  \key d \minor
  \time 4/4
  d1 | bes1 | g1 | a1 |
  d1 | bes1 | g1 | a1 |
}

\score {
  \new StaffGroup <<
    \new Staff \with { instrumentName = "Lead" } { \lead }
    \new Staff \with { instrumentName = "Pad" } { \pad }
    \new Staff \with { instrumentName = "Bass" } { \bass }
  >>
  \layout { }
  \midi { }
}
