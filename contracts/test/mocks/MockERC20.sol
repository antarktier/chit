// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    enum Behavior {
        Standard,
        ReturnFalse,
        NoReturn,
        Fee
    }

    Behavior public behavior;

    function setBehavior(Behavior next) external {
        behavior = next;
    }

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) private returns (bool) {
        if (behavior == Behavior.ReturnFalse) return false;
        balanceOf[from] -= amount;
        balanceOf[to] += behavior == Behavior.Fee ? amount - 1 : amount;
        if (behavior == Behavior.NoReturn) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        return true;
    }
}
