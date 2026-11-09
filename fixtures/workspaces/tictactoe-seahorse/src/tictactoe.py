from seahorse.prelude import *

declare_id('7MGoWGzhWpN7suDk3SETn4Ee3ENFcEaXoFGj7vNkiB7t')

# Game account
class Game(Account):
    ...


#   Winning states
class GameState(Enum):
    ...


# initialize game
@instruction
def init_game():
    ...


# check if someone has won
def win_check()-> GameState:
    ...


# play a turn
@instruction
def play_game():
    ...
   