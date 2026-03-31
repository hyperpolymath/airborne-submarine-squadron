\version "2.25.32"

\header {
  title = "Bathymetric Drift"
  subtitle = "Underwater"
  composer = "Airborne Submarine Squadron (sketch)"
}

lead = \relative c' {
  \key c \minor
  \time 6/8
  \tempo 4. = 76
  c4. d8 ees g | g4. ees8 d c |
  c4. d8 ees g | aes4. g8 f ees |
}

pad = \relative c' {
  \key c \minor
  \time 6/8
  c2. | aes2. | f2. | g2. |
  c2. | aes2. | f2. | g2. |
}

bass = \relative c {
  \key c \minor
  \time 6/8
  c4. c | aes4. aes | f4. f | g4. g |
  c4. c | aes4. aes | f4. f | g4. g |
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
