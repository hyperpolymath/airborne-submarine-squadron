\version "2.25.32"

\header {
  title = "Redline Pressure"
  subtitle = "Danger"
  composer = "Airborne Submarine Squadron (sketch)"
}

lead = \relative c' {
  \key e \phrygian
  \time 7/8
  \tempo 4 = 142
  e8 f g f e d e | e g f e d c d |
  e8 f g f e d e | e g f e d c d |
}

pulse = \relative c {
  \key e \phrygian
  \time 7/8
  e8 e r e e r e | e e r e e r e |
  f8 f r f f r f | e e r e e r e |
}

bass = \relative c {
  \key e \phrygian
  \time 7/8
  e4. e4. e8 | e4. e4. e8 |
  f4. f4. f8 | e4. e4. e8 |
}

\score {
  \new StaffGroup <<
    \new Staff \with { instrumentName = "Lead" } { \lead }
    \new Staff \with { instrumentName = "Pulse" } { \pulse }
    \new Staff \with { instrumentName = "Bass" } { \bass }
  >>
  \layout { }
  \midi { }
}
