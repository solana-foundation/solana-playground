from seahorse.prelude import *

declare_id('Fv5Ct64iCZ83Te3sc2SWbP9MwiK8JHUANQrf68ArEdqL')

# User profile
class UserProfile(Account):
    ...


# Todo list item
class TodoAccount(Account):
    ...


# initialize user profile
@instruction
def init_user_profile():
    ...


# add task to user's list
@instruction
def add_task():
    ...


# mark task as done
@instruction
def mark_task_as_done():
    ...