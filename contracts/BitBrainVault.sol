// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract BitBrainVault is Ownable {
    uint256 public constant SESSION_PRICE = 0.0001 ether;
    uint256 public constant SESSION_DURATION = 15 minutes;

    mapping(address => uint256) public expiryTimestamp;

    event AccessPurchased(address indexed user, uint256 newExpiryTimestamp);
    event Withdrawn(address indexed owner, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Purchase or extend access session by paying cBTC.
     */
    function buyAccess() external payable {
        require(msg.value == SESSION_PRICE, "BitBrain: Incorrect cBTC amount paid");

        if (expiryTimestamp[msg.sender] < block.timestamp) {
            expiryTimestamp[msg.sender] = block.timestamp + SESSION_DURATION;
        } else {
            expiryTimestamp[msg.sender] += SESSION_DURATION;
        }

        emit AccessPurchased(msg.sender, expiryTimestamp[msg.sender]);
    }

    /**
     * @notice Check if a user currently has access.
     */
    function hasAccess(address user) external view returns (bool) {
        return block.timestamp < expiryTimestamp[user];
    }

    /**
     * @notice Withdraw collected cBTC. Only accessible by the owner.
     */
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "BitBrain: No balance to withdraw");

        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "BitBrain: Transfer failed");

        emit Withdrawn(owner(), balance);
    }

    // Fallback and receive functions
    receive() external payable {}
    fallback() external payable {}
}
